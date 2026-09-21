/**
 * 本地同步状态存储（镜像快照 / 同步日志 / 冲突备份）
 *
 * 三张表都只在本地 SQLite 存在（见 db/schema.sqlite.ts 末尾说明）。
 * 与 `SyncEndpoint` 一样接收注入的句柄：桌面端传运行时 db，测试传临时库。
 */
import { sql } from 'drizzle-orm';
import type { RowSnapshot, SyncReport } from './core/types';
import type { SqliteLikeDb } from './adapters/sqlite-endpoint';

/**
 * 需要 `updated_at` 的业务表（与 scripts/pg-add-updated-at.sql 保持一致）
 * 用途：本地旧库幂等补列
 */
const BUSINESS_UPDATED_AT_TABLES = [
  'calendar_events', 'checkin_tasks', 'comments', 'doc_bundles', 'doc_categories',
  'github_users', 'nav_sub_categories', 'photos', 'todos', 'web_categories',
  'websites', 'admin_applications', 'article_categories', 'article_post_categories',
];

/** 一行镜像记录 */
interface MirrorRow {
  row_id: string;
  row_hash: string;
}

/** 一条冲突备份 */
export interface ConflictRecord {
  table: string;
  rowId: string;
  localJson: string;
  remoteJson: string;
  winner: 'local' | 'remote';
}

export class LocalSyncStore {
  private readonly db: SqliteLikeDb;
  private readonly now: () => number;

  constructor(db: SqliteLikeDb, now: () => number = () => Date.now()) {
    this.db = db;
    this.now = now;
  }

  /**
   * 本地 schema 幂等补齐（同步三表 + 业务表 updated_at 列）
   *
   * 为什么需要：桌面端本地库可能是**旧模板**复制的，或应用升级后 schema 落后
   * （实测：旧本地库缺 14 张业务表的 `updated_at` → 页面查询直接 500）。
   * 全部语句都是"存在即跳过"的幂等写法，每次同步前跑一次成本可忽略。
   */
  async ensureSchema(): Promise<void> {
    await this.db.run(sql`CREATE TABLE IF NOT EXISTS sync_mirror (
      "table" TEXT NOT NULL,
      row_id TEXT NOT NULL,
      row_hash TEXT NOT NULL,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY ("table", row_id)
    )`);
    await this.db.run(sql`CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      ok BOOLEAN NOT NULL DEFAULT 0,
      report_json TEXT NOT NULL DEFAULT '{}'
    )`);
    await this.db.run(sql`CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY,
      "table" TEXT NOT NULL,
      row_id TEXT NOT NULL,
      local_json TEXT NOT NULL DEFAULT '{}',
      remote_json TEXT NOT NULL DEFAULT '{}',
      winner TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    await this.ensureBusinessColumns();
  }

  /**
   * 业务表 `updated_at` 幂等补列（D4 同步引入）
   *
   * SQLite 没有 `ADD COLUMN IF NOT EXISTS`，用 try/catch 逐条容错实现幂等；
   * 补列后回填 `updated_at = created_at`，保证 LWW 有可比基准。
   */
  private async ensureBusinessColumns(): Promise<void> {
    for (const table of BUSINESS_UPDATED_AT_TABLES) {
      try {
        await this.db.run(sql.raw(`ALTER TABLE "${table}" ADD COLUMN updated_at INTEGER`));
      } catch {
        /* 列已存在：忽略 */
      }
      try {
        await this.db.run(
          sql.raw(`UPDATE "${table}" SET updated_at = created_at WHERE updated_at IS NULL`),
        );
      } catch {
        /* 无 created_at 或表不存在：忽略 */
      }
    }
  }

  /** 是否还没有任何镜像（= 首次同步：此时删除不传播，需在报告里警告） */
  async isMirrorEmpty(): Promise<boolean> {
    const rows = await this.db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM sync_mirror`);
    return (rows?.[0]?.c ?? 0) === 0;
  }

  /** 读某表的镜像快照（base） */
  async loadMirror(table: string): Promise<Map<string, RowSnapshot>> {
    const rows = await this.db.all<MirrorRow>(
      sql`SELECT row_id, row_hash FROM sync_mirror WHERE "table" = ${table}`,
    );
    const map = new Map<string, RowSnapshot>();
    for (const r of rows ?? []) {
      // 镜像只存 id + 哈希（内容以本地库当前行为准），updatedAt 由行本身提供
      map.set(r.row_id, { id: r.row_id, hash: r.row_hash, updatedAt: null, row: {} });
    }
    return map;
  }

  /**
   * 推进某表镜像（整表替换）
   *
   * ⚠️ 只在**整张表同步成功后**调用：这样中断重跑时，未完成的表会重算，
   *    已完成的表因 base 与两侧一致而无操作（断点续传 + 幂等）。
   */
  async saveMirror(table: string, snapshots: Map<string, RowSnapshot>): Promise<void> {
    const at = this.now();
    // 事务包裹：首次全量拉取要写数百上千行，逐行提交会让 fsync 次数爆炸（实测慢到分钟级）
    await this.transaction(async () => {
      await this.db.run(sql`DELETE FROM sync_mirror WHERE "table" = ${table}`);
      for (const snap of snapshots.values()) {
        await this.db.run(
          sql`INSERT INTO sync_mirror ("table", row_id, row_hash, synced_at) VALUES (${table}, ${snap.id}, ${snap.hash}, ${at})`,
        );
      }
    });
  }

  /** 事务包裹（BEGIN IMMEDIATE / COMMIT / 失败 ROLLBACK） */
  private async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.db.run(sql`BEGIN IMMEDIATE`);
    try {
      const result = await fn();
      await this.db.run(sql`COMMIT`);
      return result;
    } catch (err) {
      try {
        await this.db.run(sql`ROLLBACK`);
      } catch {
        /* 忽略回滚失败，保留原始错误 */
      }
      throw err;
    }
  }

  /** 记录冲突（败方整行留痕） */
  async recordConflicts(records: ConflictRecord[]): Promise<void> {
    if (records.length === 0) return;
    const at = this.now();
    await this.transaction(async () => {
      for (const c of records) {
        await this.db.run(
          sql`INSERT INTO sync_conflicts (id, "table", row_id, local_json, remote_json, winner, created_at)
              VALUES (${crypto.randomUUID()}, ${c.table}, ${c.rowId}, ${c.localJson}, ${c.remoteJson}, ${c.winner}, ${at})`,
        );
      }
    });
  }

  /** 写一次同步日志 */
  async writeLog(report: SyncReport): Promise<void> {
    await this.db.run(
      sql`INSERT INTO sync_log (id, started_at, finished_at, ok, report_json)
          VALUES (${crypto.randomUUID()}, ${report.startedAt}, ${report.finishedAt}, ${report.ok ? 1 : 0}, ${JSON.stringify(report)})`,
    );
  }

  /** 最近一次同步报告（设置页展示） */
  async lastReport(): Promise<SyncReport | null> {
    const rows = await this.db.all<{ report_json: string }>(
      sql`SELECT report_json FROM sync_log ORDER BY started_at DESC LIMIT 1`,
    );
    const raw = rows?.[0]?.report_json;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SyncReport;
    } catch {
      return null;
    }
  }

  /** 最近若干条冲突记录（排障用） */
  async recentConflicts(limit = 20): Promise<ConflictRecord[]> {
    const rows = await this.db.all<{
      table: string;
      row_id: string;
      local_json: string;
      remote_json: string;
      winner: 'local' | 'remote';
    }>(
      sql`SELECT "table", row_id, local_json, remote_json, winner FROM sync_conflicts ORDER BY created_at DESC LIMIT ${limit}`,
    );
    return (rows ?? []).map((r) => ({
      table: r.table,
      rowId: r.row_id,
      localJson: r.local_json,
      remoteJson: r.remote_json,
      winner: r.winner,
    }));
  }
}
