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
      max: 1,
      idle_timeout: 5,
      connect_timeout: 3,
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

/** 写操作属性：这些操作会在全部端点（主+备）上执行，保证两库一致 */
const WRITE_PROPS = new Set(['insert', 'update', 'delete']);

type AnyFn = (...args: never[]) => unknown;

/** 双写镜像：把一次写操作的链式调用镜像到所有端点；await 时全部执行、返回主库结果 */
function dualWriteProxy(create: (d: BlogDb) => unknown): unknown {
  const builders: unknown[] = [];
  const ensureBuilders = (): void => {
    if (builders.length > 0) return;
    endpoints.forEach((ep, i) => {
      if (!ep.db) ep.db = createDrizzle(ep, i);
      builders.push(create(ep.db!));
    });
  };
  const executeAll = (): Promise<unknown> => {
    ensureBuilders();
    return Promise.all(
      builders.map((b, i) =>
        Promise.resolve(b as PromiseLike<unknown>).then(
          (v) => ({ ok: true as const, i, v }),
          (e) => ({ ok: false as const, i, e: e as Error }),
        ),
      ),
    ).then((results) => {
      for (const r of results) {
        if (!r.ok) {
          breaker.markDown(r.i);
          console.error(`[dbWrite] 端点 ${endpoints[r.i]!.name} 写入失败:`, r.e);
        }
      }
      const ok = results.find((r) => r.ok);
      if (ok) return ok.v;
      const err = results.find((r) => !r.ok) as { e: Error } | undefined;
      throw err?.e ?? new Error('双写全部失败');
    });
  };
  return new Proxy({} as Record<PropertyKey, unknown>, {
    get(_t, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return (...args: unknown[]) => {
          const p = executeAll();
          const fn = (p as unknown as Record<string, unknown>)[String(prop)];
          return (fn as AnyFn).apply(p as never, args as never);
        };
      }
      if (typeof prop === 'symbol') return undefined;
      return (...args: unknown[]) => {
        ensureBuilders();
        const next: unknown[] = [];
        for (const b of builders) {
          const fn = (b as Record<PropertyKey, unknown>)[prop];
          if (typeof fn !== 'function') return next[0];
          next.push((fn as AnyFn).apply(b as never, args as never));
        }
        return dualWriteProxy(() => next.shift() as BlogDb);
      };
    },
  });
}

/**
 * 对外统一数据库句柄：Proxy 使 `db.select/insert/update/delete/...` 每次调用时
 * 动态路由到当前健康端点，从而在端点故障后自动切换；
 * 其中 `insert/update/delete` 为**双写**（主+备都执行，详见 dualWriteProxy）。
 */
export const db: BlogDb = new Proxy({} as BlogDb, {
  get(_target, prop) {
    if (typeof prop === 'string' && WRITE_PROPS.has(prop)) {
      return (...args: unknown[]) =>
        dualWriteProxy((d) =>
          (d as unknown as Record<string, AnyFn>)[prop]!(...(args as never[])),
        );
    }
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

/**
 * 全量双写：同一写操作在**全部**端点（主库 + 备用库）上依次执行，保证两库一致。
 *
 * 背景：主备熔断按「当前健康端点」路由，若写只落一侧、读落另一侧，会出现
 * 「页面间值不一致 / 回显旧值 / 数据分叉」等问题。双写后任一端点都持有最新数据，
 * 读取无论落在哪个端点都一致；主库故障期间的写入落在备库不丢，恢复后由对账脚本回填。
 *
 * - 返回**第一个成功**端点（即主库）的结果；其余端点继续尽力执行；
 * - 某端点失败：仅标记冷却并记录日志，不阻断其余端点（尽力同步）；
 * - 全部端点失败：抛出最后一次错误；
 * - 单端点（本地 SQLite / 未配置 FALLBACK）时行为与直接写一致。
 */
export async function dbWrite<T>(build: (d: BlogDb) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let lastErr: unknown;
  let anySuccess = false;
  for (let i = 0; i < endpoints.length; i += 1) {
    const ep = endpoints[i]!;
    if (!ep.db) ep.db = createDrizzle(ep, i);
    try {
      const r = await build(ep.db);
      if (result === undefined) result = r; // 保留主库（首个成功端点）的结果
      anySuccess = true;
    } catch (err) {
      lastErr = err;
      breaker.markDown(i);
      console.error(`[dbWrite] 端点 ${ep.name} 写入失败:`, err);
    }
  }
  if (!anySuccess && lastErr !== undefined) throw lastErr;
  return result as T;
}
