/**
 * 同步引擎端到端测试（两个真实 SQLite 库：本地 + "云端替身"）
 *
 * 为什么可以用 SQLite 当云端替身：引擎只依赖 `SyncEndpoint` 接口，
 * 真云端（PG）与替身（SQLite）在语义上等价 —— 于是无需云库、无需 mock，
 * 就能把「收敛 / 删除传播 / 冲突留痕 / 幂等 / 镜像推进 / 断点续传」全部验证。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runSync } from '../src/sync/engine';
import { SqliteEndpoint, type SqliteLikeDb } from '../src/sync/adapters/sqlite-endpoint';
import { LocalSyncStore } from '../src/sync/local-store';
import type { SyncPolicy } from '../src/sync/core/types';

const requireHere = createRequire(import.meta.url);

/** 测试用表结构（lww 表 + union 表各一） */
const DDL = `
  CREATE TABLE demo_lww (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    -- ⚠️ 故意设为 NOT NULL 且无默认值：与真实 DDL 一致（默认值由 drizzle 应用层给），
    --    用于覆盖"云端行缺该列"的兜底补值路径
    created_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE demo_union (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL DEFAULT '',
    updated_at INTEGER
  );
  CREATE TABLE sync_mirror (
    "table" TEXT NOT NULL,
    row_id TEXT NOT NULL,
    row_hash TEXT NOT NULL,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY ("table", row_id)
  );
  CREATE TABLE sync_log (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    ok BOOLEAN NOT NULL DEFAULT 0,
    report_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE sync_conflicts (
    id TEXT PRIMARY KEY,
    "table" TEXT NOT NULL,
    row_id TEXT NOT NULL,
    local_json TEXT NOT NULL DEFAULT '{}',
    remote_json TEXT NOT NULL DEFAULT '{}',
    winner TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

/**
 * 云侧 DDL 变体：把 `updated_at` 放开为可空
 * 用于模拟「云端 schema 落后于本地」——本地 NOT NULL、云端可空/缺列的真实升级场景。
 */
const DDL_CLOUD = DDL.replace('updated_at INTEGER NOT NULL', 'updated_at INTEGER');

const POLICIES: SyncPolicy[] = [
  { table: 'demo_lww', pk: ['id'], role: 'lww', changeBy: 'updated_at' },
  { table: 'demo_union', pk: ['id'], role: 'union', changeBy: 'hash' },
];

/** 测试夹具：既能当端点句柄（all/run），也能直接 exec / close（建数据、清理） */
interface TestDb extends SqliteLikeDb {
  exec: (sqlText: string) => void;
  close: () => void;
}

interface Env {
  dir: string;
  local: SqliteEndpoint;
  cloud: SqliteEndpoint;
  store: LocalSyncStore;
  localRaw: TestDb;
  cloudRaw: TestDb;
  sync: () => ReturnType<typeof runSync>;
}

let env: Env;

/** 建一个带表结构的临时库，返回「端点句柄 + 原生 exec/close」的复合夹具 */
function makeDb(file: string, ddl: string = DDL): TestDb {
  const Database = requireHere('better-sqlite3');
  const { drizzle } = requireHere('drizzle-orm/better-sqlite3');
  const client = new Database(file);
  client.exec(ddl);
  const handle = drizzle(client) as unknown as SqliteLikeDb;
  return {
    all: (q) => handle.all(q),
    run: (q) => handle.run(q),
    exec: (sqlText: string) => client.exec(sqlText),
    close: () => client.close(),
  };
}

function makeEnv(): Env {
  const dir = mkdtempSync(path.join(tmpdir(), 'byqx-engine-'));
  const localRaw = makeDb(path.join(dir, 'local.db'));
  const cloudRaw = makeDb(path.join(dir, 'cloud.db'), DDL_CLOUD);
  const local = new SqliteEndpoint(localRaw, 'local');
  const cloud = new SqliteEndpoint(cloudRaw, 'cloud');
  const store = new LocalSyncStore(localRaw);
  return {
    dir,
    local,
    cloud,
    store,
    localRaw,
    cloudRaw,
    sync: () => runSync({ local, cloud, store, policies: POLICIES }),
  };
}

beforeEach(() => {
  env = makeEnv();
});

afterEach(() => {
  env.localRaw.close(); // ⚠️ Windows：句柄不关则目录删不掉
  env.cloudRaw.close();
  rmSync(env.dir, { recursive: true, force: true });
});

describe('同步引擎 · 端到端（SQLite 替身云端）', () => {
  it('首次同步：云端行全量拉到本地，并提示"删除不传播"', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('a','云端A',1000), ('b','云端B',1000);`);
    const report = await env.sync();

    expect(report.ok).toBe(true);
    const lww = report.perTable.find((t) => t.table === 'demo_lww')!;
    expect(lww.pulled).toBe(2);
    expect(lww.pushed).toBe(0);
    expect(report.warnings.join()).toContain('首次同步');

    const localRows = await env.local.readRows('demo_lww');
    expect(localRows.map((r) => r.title).sort()).toEqual(['云端A', '云端B']);
  });

  it('本地新增 → 推送到云端', async () => {
    await env.sync(); // 先建立镜像
    env.localRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('c','本地新写',2000);`);
    const report = await env.sync();

    const lww = report.perTable.find((t) => t.table === 'demo_lww')!;
    expect(lww.pushed).toBe(1);
    expect(lww.pulled).toBe(0);

    const cloudRows = await env.cloud.readRows('demo_lww');
    expect(cloudRows.map((r) => r.id)).toEqual(['c']);
  });

  it('本地删除 → 传播到云端（镜像差分，非软删除列）', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('a','A',1000), ('b','B',1000);`);
    await env.sync(); // 建立镜像（本地已有 a、b）
    env.localRaw.exec(`DELETE FROM demo_lww WHERE id='a';`);
    const report = await env.sync();

    const lww = report.perTable.find((t) => t.table === 'demo_lww')!;
    expect(lww.deletedRemote).toBe(1);
    const cloudRows = await env.cloud.readRows('demo_lww');
    expect(cloudRows.map((r) => r.id)).toEqual(['b']);
  });

  it('云端删除 → 传播到本地', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('a','A',1000), ('b','B',1000);`);
    await env.sync();
    env.cloudRaw.exec(`DELETE FROM demo_lww WHERE id='a';`);
    const report = await env.sync();

    const lww = report.perTable.find((t) => t.table === 'demo_lww')!;
    expect(lww.deletedLocal).toBe(1);
    const localRows = await env.local.readRows('demo_lww');
    expect(localRows.map((r) => r.id)).toEqual(['b']);
  });

  it('双方都改同一行 → LWW 裁决（本地较新胜）+ 冲突留痕', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('a','原始',1000);`);
    await env.sync();
    // 两边各改各的，本地时间更新
    env.localRaw.exec(`UPDATE demo_lww SET title='本地改', updated_at=3000 WHERE id='a';`);
    env.cloudRaw.exec(`UPDATE demo_lww SET title='云端改', updated_at=2000 WHERE id='a';`);
    const report = await env.sync();

    const lww = report.perTable.find((t) => t.table === 'demo_lww')!;
    expect(lww.conflicts).toBe(1);
    // 本地胜 → 云端被改成"本地改"
    const cloudRows = await env.cloud.readRows('demo_lww');
    expect(cloudRows[0]?.title).toBe('本地改');

    // 败方（云端改）整行被备份，绝不静默丢弃
    const conflicts = await env.store.recentConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.winner).toBe('local');
    expect(conflicts[0]?.remoteJson).toContain('云端改');
  });

  it('立刻重复同步 → 全部零操作（幂等）', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('a','A',1000);`);
    await env.sync();
    const second = await env.sync();

    for (const t of second.perTable) {
      expect(t.pushed, `${t.table} pushed`).toBe(0);
      expect(t.pulled, `${t.table} pulled`).toBe(0);
      expect(t.deletedLocal, `${t.table} deletedLocal`).toBe(0);
      expect(t.deletedRemote, `${t.table} deletedRemote`).toBe(0);
      expect(t.conflicts, `${t.table} conflicts`).toBe(0);
    }
  });

  it('镜像推进：同步后两张表都有 base 快照（断点续传基础）', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('a','A',1000); INSERT INTO demo_union VALUES ('u1','U',1000);`);
    await env.sync();

    const lwwBase = await env.store.loadMirror('demo_lww');
    const unionBase = await env.store.loadMirror('demo_union');
    expect(lwwBase.size).toBe(1);
    expect(unionBase.size).toBe(1);
    // 空镜像判定应转为 false（下次同步不再提示"首次同步"）
    expect(await env.store.isMirrorEmpty()).toBe(false);
    // 同步日志已落库，可读回最近报告
    const last = await env.store.lastReport();
    expect(last?.perTable.length).toBe(POLICIES.length);
  });

  it('union 表：两侧各改不同行 → 双向补齐、互不覆盖', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_union VALUES ('u1','原1',1000), ('u2','原2',1000);`);
    await env.sync();
    env.localRaw.exec(`UPDATE demo_union SET payload='本地改u1' WHERE id='u1';`);
    env.cloudRaw.exec(`UPDATE demo_union SET payload='云端改u2' WHERE id='u2';`);
    await env.sync();

    const localRows = await env.local.readRows('demo_union');
    const cloudRows = await env.cloud.readRows('demo_union');
    const localMap = new Map(localRows.map((r) => [String(r.id), String(r.payload)]));
    const cloudMap = new Map(cloudRows.map((r) => [String(r.id), String(r.payload)]));
    expect(localMap.get('u1')).toBe('本地改u1');
    expect(localMap.get('u2')).toBe('云端改u2');
    expect(cloudMap.get('u1')).toBe('本地改u1');
    expect(cloudMap.get('u2')).toBe('云端改u2');
  });

  it('云端行缺 updated_at 时兜底补值（用 created_at），不再整表失败', async () => {
    // 模拟单边 schema 落后：云端行没有 updated_at（本地该列 NOT NULL）
    env.cloudRaw.exec(`INSERT INTO demo_lww (id, title, created_at) VALUES ('z1','缺更新时间的行',1234);`);
    const report = await env.sync();

    const lww = report.perTable.find((t) => t.table === 'demo_lww')!;
    expect(lww.skipped).toBeUndefined();
    expect(lww.pulled).toBe(1);
    const rows = await env.local.readRows('demo_lww');
    expect(rows[0]?.updated_at).toBe(1234); // 兜底取 created_at
  });

  it('单表失败不阻断其他表（报告 skipped + 全局 ok=false）', async () => {
    env.cloudRaw.exec(`INSERT INTO demo_lww (id,title,updated_at) VALUES ('a','A',1000);`);
    // 让 union 表读取失败：重命名云端表（模拟该表结构问题）
    env.cloudRaw.exec(`DROP TABLE demo_union;`);
    const report = await env.sync();

    const unionStat = report.perTable.find((t) => t.table === 'demo_union')!;
    const lwwStat = report.perTable.find((t) => t.table === 'demo_lww')!;
    expect(unionStat.skipped).toBeTruthy();
    expect(lwwStat.pulled).toBe(1); // 其他表照常完成
    expect(report.ok).toBe(false);
  });
});
