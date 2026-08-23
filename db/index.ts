/**
 * 数据库驱动选择与单例
 *
 * 设计说明（双方言单代码路径）：
 * - 按 `DATABASE_URL` 前缀选择驱动：`postgres://`/`postgresql://` → PostgreSQL（生产，
 *   如 Vercel + Neon）；其余（默认 `file:./data/blog.db`）→ SQLite（开发，better-sqlite3）。
 * - sqlite 与 pg 的 `schema.sqlite.ts` / `schema.pg.ts` 字段完全一致，查询语句基于
 *   sqlite 元数据构建，对 pg 同样生成合法 SQL（文本列通用；pg 的 jsonb 列接受 JSON
 *   字符串入参，select 返回解析后的数组，由 `src/lib/tags.ts` 统一归一化）。
 * - 因此对外仅暴露一个以 sqlite schema 为准的类型 `BlogDb`，pg 分支做一次收口 cast。
 */
import Database from 'better-sqlite3';
import { drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import postgres from 'postgres';
import { drizzle as drizzlePostgresJs } from 'drizzle-orm/postgres-js';
import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';
import { isPostgres } from './dialect';

/** 数据库连接串（默认本地 SQLite 开发库） */
const DATABASE_URL: string = process.env.DATABASE_URL ?? 'file:./data/blog.db';

/** 对外统一数据库句柄类型（以 sqlite schema 为准，两方言形状一致） */
export type BlogDb = BetterSQLite3Database<typeof sqliteSchema>;

let cached: BlogDb | undefined;

/**
 * 获取（惰性创建）数据库单例
 *
 * @returns 统一的 drizzle 数据库句柄
 */
export function getDb(): BlogDb {
  if (cached) return cached;
  if (isPostgres) {
    // 生产：postgres.js 客户端 + pg schema（形状一致，cast 收口处）
    // 时间戳序列化由 schema.sqlite 的 timestampMs 列处理（PG 模式输出 ISO 字符串）
    const client = postgres(DATABASE_URL, { max: 5 });
    cached = drizzlePostgresJs(client, { schema: pgSchema }) as unknown as BlogDb;
  } else {
    // 开发：better-sqlite3 + WAL 模式
    const file = DATABASE_URL.startsWith('file:') ? DATABASE_URL.slice('file:'.length) : DATABASE_URL;
    const client = new Database(file);
    client.pragma('journal_mode = WAL');
    cached = drizzleBetterSqlite(client, { schema: sqliteSchema });
  }
  return cached;
}

/** 数据库单例（模块加载即初始化） */
export const db: BlogDb = getDb();
