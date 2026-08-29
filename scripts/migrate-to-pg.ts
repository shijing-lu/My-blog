/**
 * SQLite → PostgreSQL 一次性数据迁移脚本
 *
 * 用途：把本地开发库（data/blog.db）的全部数据搬到生产 PostgreSQL（Neon/Supabase 等），
 * 供 Vercel Serverless 部署使用（也用于初始化备用库以供故障转移）。
 *
 * 用法（连接串必须以 postgres:// 或 postgresql:// 开头）：
 *   pnpm db:migrate-data -- --url=postgres://user:pass@host/db?sslmode=require
 *   MIGRATE_PG_URL=postgres://... pnpm db:migrate-data
 *
 * 特性：
 * - 覆盖全部 23 张表（按表名字典序）
 * - 自动类型转换：SQLite 毫秒时间戳 → PG timestamptz；SQLite 0/1 → PG boolean
 * - 幂等：所有 INSERT 带 ON CONFLICT DO NOTHING，重复执行不会重复插入
 * - 用 RETURNING 1 精确统计"本次新增行数"（被 ON CONFLICT 跳过的不计入）
 * - base64 大表（images/fonts）单条提交，避免单条 SQL 过大
 * - --dry-run 只读 SQLite 统计，不连接 PG
 */
import Database from 'better-sqlite3';
import postgres from 'postgres';

/** 需要毫秒整数 → Date 转换的时间戳列 */
const TIMESTAMP_COLS = new Set(['created_at', 'updated_at', 'taken_at']);
/** 需要 0/1 → boolean 转换的布尔列 */
const BOOLEAN_COLS = new Set(['done', 'repeat', 'lunar', 'completed']);

/** base64 大表：单条提交，避免单条 SQL 过大被服务端拒绝 */
const SINGLE_ROW_TABLES = new Set(['images', 'fonts']);

/** 参与迁移的表（与 db/schema.sqlite.ts / schema.pg.ts 一致） */
const TABLES = [
  'articles', 'calendar_events', 'checkin_records', 'checkin_tasks', 'comments',
  'diary_entries', 'doc_articles', 'doc_bundles', 'doc_categories', 'fonts',
  'github_users', 'images', 'likes', 'mindmaps', 'moments', 'photos', 'settings',
  'study_distractions', 'study_sessions', 'study_tasks', 'todos', 'web_categories',
  'websites',
] as const;

/** 解析命令行 --url= 参数 */
function parseUrlArg(): string | undefined {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--url=')) return arg.slice('--url='.length).trim();
  }
  return undefined;
}

const dryRun = process.argv.includes('--dry-run');
const url = parseUrlArg() || process.env.MIGRATE_PG_URL || '';

if (!dryRun && !/^postgres(ql)?:\/\//.test(url)) {
  console.error('❌ 需要 PostgreSQL 连接串（postgres:// 开头）：');
  console.error('   pnpm db:migrate-data -- --url=postgres://user:pass@host/db?sslmode=require');
  console.error('   或设置环境变量 MIGRATE_PG_URL');
  process.exit(1);
}

/** 打开本地 SQLite（只读） */
const sqlite = new Database('data/blog.db', { readonly: true });

/** 单值转换：按列名把 SQLite 值转成 PG 可接受的 JS 值 */
function convertValue(col: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (TIMESTAMP_COLS.has(col)) return new Date(Number(value));
  if (BOOLEAN_COLS.has(col)) return Boolean(Number(value));
  return value;
}

/** 迁移单张表，返回 { 源行数, 新增行数 } */
async function migrateTable(
  sql: postgres.Sql | undefined,
  table: string,
): Promise<{ source: number; inserted: number }> {
  const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  if (rows.length === 0) {
    console.log(`  ${table.padEnd(22)} 0 行，跳过`);
    return { source: 0, inserted: 0 };
  }
  if (dryRun || !sql) {
    console.log(`  ${table.padEnd(22)} ${rows.length} 行（dry-run，不写入）`);
    return { source: rows.length, inserted: 0 };
  }

  const cols = Object.keys(rows[0]!);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const BATCH = SINGLE_ROW_TABLES.has(table) ? 1 : 50;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // 位置参数 $1..$n（n = 行数 × 列数）
    const placeholders = batch
      .map((_, r) => `(${cols.map((_, ci) => `$${r * cols.length + ci + 1}`).join(', ')})`)
      .join(', ');
    const params: unknown[] = [];
    for (const row of batch) {
      for (const c of cols) params.push(convertValue(c, row[c]));
    }
    // RETURNING 1：仅返回真正插入的行（被 ON CONFLICT 跳过的不返回），用于精确计数
    const result = await sql.unsafe(
      `INSERT INTO "${table}" (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING RETURNING 1`,
      params,
    );
    inserted += (result as unknown[]).length;
  }
  console.log(`  ${table.padEnd(22)} ${rows.length} 行 → 新增 ${inserted} 行（其余已存在，跳过）`);
  return { source: rows.length, inserted };
}

async function main() {
  console.log(dryRun ? '🔍 dry-run 模式：仅统计本地 SQLite 数据\n' : `🚀 开始迁移 SQLite → ${url.replace(/:[^:@/]+@/, ':****@')}\n`);

  const sql = dryRun ? undefined : postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });

  let totalSource = 0;
  let totalInserted = 0;
  try {
    for (const table of TABLES) {
      const { source, inserted } = await migrateTable(sql, table);
      totalSource += source;
      totalInserted += inserted;
    }
    console.log(`\n✅ 完成：源 ${totalSource} 行，本次新增 ${totalInserted} 行${totalInserted < totalSource ? '（其余已存在）' : ''}`);
  } finally {
    sqlite.close();
    if (sql) await sql.end({ timeout: 10 });
  }
}

main().catch((err) => {
  console.error('❌ 迁移失败：', err);
  process.exit(1);
});
