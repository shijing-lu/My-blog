/**
 * SQLite 端点（本地主库）
 *
 * - 句柄**由外部注入**（可以是运行时 db，也可以是测试里的临时库），
 *   因此同一份代码既能跑桌面端真实同步，也能在单测里当"云端替身"；
 * - 全部用 drizzle 的 `sql` 模板写**参数化**语句：标识符走 `sql.identifier`，值走 `${value}` 插值
 *   （⚠️ 不能用 sql.raw 拼字符串——那样占位符没有绑定值，等于写坏 SQL）；
 * - 原始 SQL 返回的是**数据库列名**（snake_case），与云端一致 → 两端行可直接比哈希。
 */
import { sql } from 'drizzle-orm';
import type { SyncRow } from '../core/types';
import { splitRowId, type SyncEndpoint } from './source';

/** 端点所需的最小 drizzle 句柄形态（better-sqlite3 驱动） */
export interface SqliteLikeDb {
  all<T = unknown>(query: unknown): Promise<T[]> | T[];
  run(query: unknown): Promise<unknown> | unknown;
}

/**
 * 绑定值归一化 —— **跨方言同步的关键一环**
 *
 * better-sqlite3 只接受 number / string / bigint / Buffer / null，因此：
 * - `boolean`（PG 的 boolean 列读回来就是 true/false）→ 1 / 0；
 * - `Date`（PG timestamp 用 mode:'date' 读回来是 Date）→ 毫秒整数（与 timestampMs 列存法一致）；
 * - `undefined` → null；
 * - 对象 / 数组 → JSON 字符串（text 列存 JSON 的既有约定）。
 * 不做这一步，同步到本地会直接抛 "can only bind numbers, strings, bigints, buffers, and null"。
 */
function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export class SqliteEndpoint implements SyncEndpoint {
  readonly name: string;
  private readonly db: SqliteLikeDb;

  constructor(db: SqliteLikeDb, name = 'local') {
    this.db = db;
    this.name = name;
  }

  async readRows(table: string): Promise<SyncRow[]> {
    const rows = await this.db.all<SyncRow>(sql`SELECT * FROM ${sql.identifier(table)}`);
    return (rows ?? []) as SyncRow[];
  }

  async upsertRows(table: string, rows: SyncRow[], _pk: string[]): Promise<number> {
    if (rows.length === 0) return 0;
    return this.inTransaction(async () => {
      let n = 0;
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        // REPLACE = 冲突即整行覆盖；同步语义本就是"以某一方的整行为准"
        const colClause = sql.join(cols.map((c) => sql.identifier(c)), sql`, `);
        const valClause = sql.join(cols.map((c) => sql`${normalizeValue(row[c])}`), sql`, `);
        await this.db.run(
          sql`INSERT OR REPLACE INTO ${sql.identifier(table)} (${colClause}) VALUES (${valClause})`,
        );
        n += 1;
      }
      return n;
    });
  }

  async updateRows(table: string, rows: SyncRow[], pk: string[]): Promise<number> {
    if (rows.length === 0) return 0;
    return this.inTransaction(async () => {
      let n = 0;
      for (const row of rows) {
        const setCols = Object.keys(row).filter((c) => !pk.includes(c));
        if (setCols.length === 0) continue;
        const setClause = sql.join(
          setCols.map((c) => sql`${sql.identifier(c)} = ${normalizeValue(row[c])}`),
          sql`, `,
        );
        const whereClause = sql.join(
          pk.map((c) => sql`${sql.identifier(c)} = ${normalizeValue(row[c])}`),
          sql` AND `,
        );
        await this.db.run(
          sql`UPDATE ${sql.identifier(table)} SET ${setClause} WHERE ${whereClause}`,
        );
        n += 1;
      }
      return n;
    });
  }

  async deleteRows(table: string, ids: string[], pk: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.inTransaction(async () => {
      for (const id of ids) {
        const values = splitRowId(id);
        const whereClause = sql.join(
          pk.map((c, i) => sql`${sql.identifier(c)} = ${values[i] ?? ''}`),
          sql` AND `,
        );
        await this.db.run(sql`DELETE FROM ${sql.identifier(table)} WHERE ${whereClause}`);
      }
      return ids.length;
    });
  }

  /**
   * 批量写包在一个事务里
   *
   * 为什么重要：SQLite 默认每次写都是一次独立事务（含 fsync），
   * 首次全量拉取要写数千行（图片/字体/点赞等），逐行提交会让耗时从秒级膨胀到分钟级。
   * 用 BEGIN IMMEDIATE...COMMIT 包起来后只 fsync 一次。
   */
  private async inTransaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.db.run(sql`BEGIN IMMEDIATE`);
    try {
      const result = await fn();
      await this.db.run(sql`COMMIT`);
      return result;
    } catch (err) {
      try {
        await this.db.run(sql`ROLLBACK`);
      } catch {
        /* 回滚失败（例如事务已被数据库隐式结束）时忽略，保留原始错误 */
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    /* 句柄由外部管理（运行时 db 是共享单例），此处不关闭 */
  }
}
