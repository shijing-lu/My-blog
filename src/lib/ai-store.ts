/**
 * AI 小卿：数据层地基（建表 + 幂等自愈）
 *
 * ## 为什么需要本文件（而不是只改 schema）
 *
 * 4 张新表要在**两个运行时**都存在：
 * - Web（Vercel + 生产 PostgreSQL）：连接串被标记 Sensitive，本地拿不到明文，无法直连跑 DDL；
 * - 桌面端（Electron + 本地 SQLite）：数据库是用户机器上的既有副本，**没有任何自动迁移机制**。
 *
 * 因此采用「**惰性幂等建表**」：任何 AI 端点第一次被调用时执行一次
 * `CREATE TABLE / INDEX IF NOT EXISTS`，之后本进程内直接跳过（`ensured` 标志）。
 * 好处：两端都零人工迁移；坏处：多一次建表探测（可忽略）。
 * 另保留 `POST /api/migrate-ai-memory` 供生产巡检（同一份 DDL，单一事实来源）。
 *
 * ## 方言处理
 *
 * - SQLite：`better-sqlite3` 通过 **惰性 require** 加载（与 `db/index.ts` 同款理由：
 *   原生 .node 模块不能被 Electron 的 PG 路径加载，也不能被打包器内联）；
 * - PostgreSQL：`postgres` 客户端 `unsafe()` 执行；主库 + 备用库**都要建**
 *   （写操作是双写镜像，缺一侧会在镜像写时报错）。
 *
 * ## 安全
 *
 * 本文件只建表，不含任何业务读写；业务查询走 drizzle `db`（表已登记进 schema）。
 * DDL 全部为 `IF NOT EXISTS`，可重复执行、不丢数据。
 */
import { createRequire } from 'node:module';
import postgres from 'postgres';
import { readDatabaseUrl, readFallbackDatabaseUrl, isPostgres, isPostgresUrl } from '../../db/dialect';

/** 4 张 AI 表的物理表名（顺序与 DDL 一致，供单测与巡检复用） */
export const AI_TABLE_NAMES = [
  'ai_conversations',
  'ai_messages',
  'ai_memories',
  'ai_bond',
] as const;

/** 建表 DDL（SQLite）：布尔列用 0/1（与 booleanFlag 的 driverData 一致） */
export const AI_DDL_SQLITE: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_conversations (
    id text PRIMARY KEY,
    title text NOT NULL DEFAULT '',
    message_count integer NOT NULL DEFAULT 0,
    depth_score integer NOT NULL DEFAULT 0,
    summarized integer NOT NULL DEFAULT 0,
    started_at integer NOT NULL,
    ended_at integer,
    updated_at integer NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS ai_conversations_updated_idx ON ai_conversations (updated_at)',
  `CREATE TABLE IF NOT EXISTS ai_messages (
    id text PRIMARY KEY,
    conversation_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    token_estimate integer NOT NULL DEFAULT 0,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages (conversation_id, created_at)',
  `CREATE TABLE IF NOT EXISTS ai_memories (
    id text PRIMARY KEY,
    kind text NOT NULL DEFAULT 'fact',
    content text NOT NULL,
    importance integer NOT NULL DEFAULT 3,
    source_conversation_id text NOT NULL DEFAULT '',
    use_count integer NOT NULL DEFAULT 0,
    last_used_at integer,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS ai_memories_rank_idx ON ai_memories (importance, updated_at)',
  `CREATE TABLE IF NOT EXISTS ai_bond (
    id text PRIMARY KEY,
    message_count integer NOT NULL DEFAULT 0,
    active_days integer NOT NULL DEFAULT 0,
    streak_days integer NOT NULL DEFAULT 0,
    max_streak integer NOT NULL DEFAULT 0,
    depth_score integer NOT NULL DEFAULT 0,
    bond_points integer NOT NULL DEFAULT 0,
    level integer NOT NULL DEFAULT 0,
    nickname text NOT NULL DEFAULT '',
    last_active_date text NOT NULL DEFAULT '',
    updated_at integer NOT NULL
  )`,
];

/** 建表 DDL（PostgreSQL）：布尔用原生 boolean、时间用 timestamptz */
export const AI_DDL_PG: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_conversations (
    id text PRIMARY KEY,
    title text NOT NULL DEFAULT '',
    message_count integer NOT NULL DEFAULT 0,
    depth_score integer NOT NULL DEFAULT 0,
    summarized boolean NOT NULL DEFAULT false,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS ai_conversations_updated_idx ON ai_conversations (updated_at)',
  `CREATE TABLE IF NOT EXISTS ai_messages (
    id text PRIMARY KEY,
    conversation_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    token_estimate integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages (conversation_id, created_at)',
  `CREATE TABLE IF NOT EXISTS ai_memories (
    id text PRIMARY KEY,
    kind text NOT NULL DEFAULT 'fact',
    content text NOT NULL,
    importance integer NOT NULL DEFAULT 3,
    source_conversation_id text NOT NULL DEFAULT '',
    use_count integer NOT NULL DEFAULT 0,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS ai_memories_rank_idx ON ai_memories (importance, updated_at)',
  `CREATE TABLE IF NOT EXISTS ai_bond (
    id text PRIMARY KEY,
    message_count integer NOT NULL DEFAULT 0,
    active_days integer NOT NULL DEFAULT 0,
    streak_days integer NOT NULL DEFAULT 0,
    max_streak integer NOT NULL DEFAULT 0,
    depth_score integer NOT NULL DEFAULT 0,
    bond_points integer NOT NULL DEFAULT 0,
    level integer NOT NULL DEFAULT 0,
    nickname text NOT NULL DEFAULT '',
    last_active_date text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];

const requireHere = createRequire(import.meta.url);
const SQLITE_PKG = 'better-sqlite3';

/** 本进程是否已完成建表（成功后才置位，失败下次仍会重试） */
let ensured = false;

/** 在 SQLite 库上执行建表（惰性 require 原生模块） */
function ensureSqlite(url: string): void {
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url;
  const ctor = requireHere(SQLITE_PKG) as typeof import('better-sqlite3');
  const client = new ctor(file);
  try {
    for (const ddl of AI_DDL_SQLITE) client.exec(ddl);
  } finally {
    client.close();
  }
}

/** 在某个 PostgreSQL 端点执行建表（主库与备用库都要） */
async function ensurePostgres(url: string): Promise<void> {
  const client = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    for (const ddl of AI_DDL_PG) await client.unsafe(ddl);
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * 幂等建表（AI 端点入口调用一次）
 *
 * 行为：成功一次后本进程内不再重复执行；失败时**不抛错**（记日志返回 false），
 * 由调用方决定是降级（聊天继续，只是记忆功能不可用）还是报错——聊天本身不应因此挂掉。
 */
export async function ensureAiTables(): Promise<boolean> {
  if (ensured) return true;
  try {
    const primary = readDatabaseUrl();
    if (isPostgres) {
      await ensurePostgres(primary);
      const fallback = readFallbackDatabaseUrl();
      if (fallback && isPostgresUrl(fallback)) await ensurePostgres(fallback);
    } else {
      ensureSqlite(primary);
    }
    ensured = true;
    return true;
  } catch (err) {
    console.error('[ai-store] ensureAiTables 失败:', (err as Error).message);
    return false;
  }
}

/** 供单测使用：重置"已建表"标志（生产代码不要调用） */
export function __resetEnsureFlagForTest(): void {
  ensured = false;
}
