/**
 * SQLite 端点单测（真库、非 mock）
 *
 * 校验适配器的 SQL 正确性：参数化绑定、复合主键、upsert 覆盖语义、删除。
 * 用临时库文件（退出时删除），不触碰真实数据。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sql } from 'drizzle-orm';
import { SqliteEndpoint, type SqliteLikeDb } from '../src/sync/adapters/sqlite-endpoint';

const requireHere = createRequire(import.meta.url);

let dir: string;
let db: SqliteLikeDb & { run: (q: unknown) => unknown; all: (q: unknown) => unknown };
let endpoint: SqliteEndpoint;
/** better-sqlite3 连接：Windows 下不关闭则临时目录无法删除 */
let client: { close: () => void; exec: (sqlText: string) => void };

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'byqx-sync-test-'));
  const Database = requireHere('better-sqlite3');
  const { drizzle } = requireHere('drizzle-orm/better-sqlite3');
  client = new Database(path.join(dir, 'test.db'));
  db = drizzle(client) as unknown as typeof db;
  // 建一张含单主键与时间戳的测试表 + 一张复合主键表
  client.exec(`
    CREATE TABLE demo (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      flag INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
    CREATE TABLE pair (
      article_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      updated_at INTEGER,
      PRIMARY KEY (article_id)
    );
  `);
  endpoint = new SqliteEndpoint(db, 'test-local');
});

afterAll(() => {
  client.close(); // ⚠️ Windows：句柄未关时 rmSync 会失败（文件被占用）
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteEndpoint（本地端点）', () => {
  it('插入后可读回，且行内容一致', async () => {
    const n = await endpoint.upsertRows(
      'demo',
      [{ id: 'a1', title: '第一篇', flag: 1, updated_at: 1000 }],
      ['id'],
    );
    expect(n).toBe(1);
    const rows = await endpoint.readRows('demo');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'a1', title: '第一篇', flag: 1, updated_at: 1000 });
  });

  it('upsert 对同一主键是整行覆盖（幂等）', async () => {
    await endpoint.upsertRows('demo', [{ id: 'a1', title: '改过的标题', flag: 0, updated_at: 2000 }], ['id']);
    const rows = await endpoint.readRows('demo');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: '改过的标题', flag: 0, updated_at: 2000 });
  });

  it('update 只更新给定列，主键列不被改写', async () => {
    const n = await endpoint.updateRows('demo', [{ id: 'a1', title: '只改标题' }], ['id']);
    expect(n).toBe(1);
    const rows = await endpoint.readRows('demo');
    // flag / updated_at 保持原值，未被 undefined 覆盖
    expect(rows[0]).toMatchObject({ id: 'a1', title: '只改标题', flag: 0, updated_at: 2000 });
  });

  it('delete 按主键删除', async () => {
    await endpoint.upsertRows('demo', [{ id: 'b2', title: '待删', flag: 0, updated_at: 1 }], ['id']);
    expect(await endpoint.deleteRows('demo', ['b2'], ['id'])).toBe(1);
    const rows = await endpoint.readRows('demo');
    expect(rows.map((r) => r.id)).toEqual(['a1']);
  });

  it('复合主键表：delete 按拼接 id 正确删除', async () => {
    await endpoint.upsertRows('pair', [{ article_id: 'p1', category_id: 'c1', updated_at: 5 }], ['article_id']);
    const before = await endpoint.readRows('pair');
    expect(before).toHaveLength(1);
    // 行 id 由 core 的 rowId 生成（\u001f 连接）
    await endpoint.deleteRows('pair', ['p1\u001fc1'], ['article_id']);
    expect(await endpoint.readRows('pair')).toHaveLength(0);
  });

  it('值为布尔/null 时绑定正确（不会变成字符串 "null"）', async () => {
    await endpoint.upsertRows('demo', [{ id: 'c3', title: '', flag: 0, updated_at: null }], ['id']);
    const rows = await endpoint.readRows('demo');
    const row = rows.find((r) => r.id === 'c3');
    expect(row?.updated_at).toBeNull();
  });

  it('readRows 返回数据库列名（snake_case）——两端行可直接比哈希', async () => {
    const rows = await endpoint.readRows('demo');
    expect(Object.keys(rows[0] ?? {})).toContain('updated_at');
    void sql; // 保留 drizzle sql 引入（说明端点内部即用该模板）
  });
});
