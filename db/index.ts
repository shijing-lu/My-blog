/**
 * 数据库驱动选择、单例与主备故障转移（circuit breaker）
 *
 * 设计说明（双方言单代码路径）：
 * - 按 `DATABASE_URL` 前缀选择驱动：`postgres://`/`postgresql://` → PostgreSQL（生产，
 *   如 Vercel + Neon/Supabase）；其余（默认 `file:./data/blog.db`）→ SQLite（开发，better-sqlite3）。
 * - 新增可选 `DATABASE_URL_FALLBACK`：指向另一个 PostgreSQL（如 Supabase）。当主库查询
 *   出错时，该端点被标记为「冷却」一段时间，后续查询自动落到备用库；冷却过期后自动
 *   回切主库。全程对业务代码透明（仍 `await db.select(...)` 即可）。
 * - 故障转移采用「下一个请求生效」语义：触发故障的那一次查询仍会抛错（返回 500），
 *   紧接着的下一个请求即走备用库——对突发限流/断连是自愈式的。
 * - sqlite 与 pg 的 `schema.sqlite.ts` / `schema.pg.ts` 字段完全一致，查询语句基于
 *   sqlite 元数据构建，对 pg 同样生成合法 SQL。
 * - 断路器纯逻辑见 `./breaker.ts`（可单测）；本文件负责端点装配与 drizzle 包装。
 */

import Database from 'better-sqlite3';
import { drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import postgres from 'postgres';
import { drizzle as drizzlePostgresJs } from 'drizzle-orm/postgres-js';
import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';
import { isPostgres, isPostgresUrl, readDatabaseUrl, readFallbackDatabaseUrl } from './dialect';
import { createCircuitBreaker, guardSql, type CircuitBreaker } from './breaker';

/** 对外统一数据库句柄类型（以 sqlite schema 为准，两方言形状一致） */
export type BlogDb = BetterSQLite3Database<typeof sqliteSchema>;

/** postgres.js 客户端实例类型（用于断路器包装） */
type Sql = ReturnType<typeof postgres>;

/** 单个数据库端点 */
interface DbEndpoint {
  /** 标识：primary | fallback */
  name: string;
  /** 连接串 */
  url: string;
  /** 是否 PostgreSQL 方言 */
  postgres: boolean;
  /** 惰性创建的 drizzle 句柄 */
  db?: BlogDb;
}

/** 端点列表：主库必选，备用库可选 */
const endpoints: DbEndpoint[] = [{ name: 'primary', url: readDatabaseUrl(), postgres: isPostgres }];
{
  const fallbackUrl = readFallbackDatabaseUrl();
  if (fallbackUrl) {
    endpoints.push({ name: 'fallback', url: fallbackUrl, postgres: isPostgresUrl(fallbackUrl) });
  }
}

/** 断路器（端点级冷却与切换）；冷却 60s：持续故障期间减少对已宕主库的探测频率，恢复后 1 分钟内自愈回切 */
const breaker: CircuitBreaker = createCircuitBreaker(endpoints.length, { cooldownMs: 60_000 });

/** 创建某端点的 drizzle 句柄；PG 端点同时挂上断路器 */
function createDrizzle(ep: DbEndpoint, index: number): BlogDb {
  if (ep.postgres) {
    const client = postgres(ep.url, {
      max: 2,
      idle_timeout: 15,
      connect_timeout: 10,
    });
    const guarded = guardSql(client, () => breaker.markDown(index)) as Sql;
    return drizzlePostgresJs(guarded, { schema: pgSchema }) as unknown as BlogDb;
  }
  const file = ep.url.startsWith('file:') ? ep.url.slice('file:'.length) : ep.url;
  const client = new Database(file);
  client.pragma('journal_mode = WAL');
  return drizzleBetterSqlite(client, { schema: sqliteSchema });
}

/** 获取当前健康端点的 drizzle 句柄（惰性创建；每次查询取用时动态选择端点） */
function getActiveDb(): BlogDb {
  const index = breaker.pick();
  const ep = endpoints[index]!;
  if (!ep.db) ep.db = createDrizzle(ep, index);
  return ep.db;
}

/**
 * 对外统一数据库句柄：Proxy 使 `db.select/insert/update/delete/...` 每次调用时
 * 动态路由到当前健康端点，从而在端点故障后自动切换。
 */
export const db: BlogDb = new Proxy({} as BlogDb, {
  get(_target, prop) {
    const active = getActiveDb();
    const value = (active as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey];
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(active)
      : value;
  },
});

/** 兼容旧导出：返回统一句柄（db / getDb 二者等价） */
export function getDb(): BlogDb {
  return db;
}
