/**
 * 构建期/本地幂等迁移：网址导航子分类（nav_sub_categories 表 + websites.sub_category_id 列）
 *
 * 背景（沿用 migrate-photos-tags.mjs 的先例）：
 * Vercel 生产环境变量标记为 Sensitive，本地无法直连生产库跑 DDL，
 * 但构建环境与运行时函数都能拿到真实连接串 —— 因此把 DDL 挂在 `pnpm build` 前执行。
 *
 * 行为约定（**永不抛错**，避免阻塞部署）：
 * - PG：对 DATABASE_URL 与 DATABASE_URL_FALLBACK 两个端点各跑一次，单点失败只打日志
 * - SQLite：直接对 .env 里的库文件建表 / 加列（本地开发用）
 * - 幂等：CREATE TABLE IF NOT EXISTS + 加列前先查 information_schema / pragma
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 从项目根 .env 读 DATABASE_URL（Astro 不注入 process.env，故手动解析） */
function envUrl() {
  try {
    const env = readFileSync(join(root, '.env'), 'utf8');
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

/* ---------------- PG ---------------- */

const PG_DDL = [
  `CREATE TABLE IF NOT EXISTS "nav_sub_categories" (
    "id" text PRIMARY KEY NOT NULL,
    "category_id" text NOT NULL,
    "name" text NOT NULL,
    "sort" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "nav_sub_categories_category_idx" ON "nav_sub_categories" ("category_id")`,
  `CREATE INDEX IF NOT EXISTS "nav_sub_categories_sort_idx" ON "nav_sub_categories" ("sort")`,
  `ALTER TABLE "websites" ADD COLUMN IF NOT EXISTS "sub_category_id" text`,
  `CREATE INDEX IF NOT EXISTS "websites_sub_category_idx" ON "websites" ("sub_category_id")`,
];

async function migratePg(name, url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    for (const ddl of PG_DDL) await sql.unsafe(ddl);
    const [tbl, col] = await Promise.all([
      sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'nav_sub_categories'`,
      sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'websites' AND column_name = 'sub_category_id'`,
    ]);
    const ok = tbl[0]?.n > 0 && col[0]?.n > 0;
    console.log(`[migrate-nav-subcats] ${name}: ${ok ? '✓ 子分类表与列就位' : '⚠ 校验未通过'}`);
    return { name, ok };
  } catch (err) {
    console.warn(`[migrate-nav-subcats] ${name}: 迁移失败 - ${err.message}`);
    return { name, error: err.message };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* ---------------- SQLite ---------------- */

async function migrateSqlite(file) {
  const mod = await import('better-sqlite3');
  const Database = mod.default ?? mod;
  const db = new Database(join(root, file));
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS nav_sub_categories (
      id text PRIMARY KEY NOT NULL,
      category_id text NOT NULL,
      name text NOT NULL,
      sort integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS nav_sub_categories_category_idx ON nav_sub_categories (category_id)');
    db.exec('CREATE INDEX IF NOT EXISTS nav_sub_categories_sort_idx ON nav_sub_categories (sort)');
    // SQLite 无 ADD COLUMN IF NOT EXISTS：先查列是否已存在
    const cols = db.prepare('PRAGMA table_info(websites)').all();
    if (!cols.some((c) => c.name === 'sub_category_id')) {
      db.exec('ALTER TABLE websites ADD COLUMN sub_category_id text');
    }
    db.exec('CREATE INDEX IF NOT EXISTS websites_sub_category_idx ON websites (sub_category_id)');
    console.log(`[migrate-nav-subcats] sqlite: ✓ 子分类表与列就位 (${file})`);
    return { name: 'sqlite', ok: true };
  } catch (err) {
    console.warn(`[migrate-nav-subcats] sqlite: 迁移失败 - ${err.message}`);
    return { name: 'sqlite', error: err.message };
  } finally {
    db.close();
  }
}

const primary = process.env.DATABASE_URL || envUrl();
const fallback = process.env.DATABASE_URL_FALLBACK;

if (!primary && !fallback) {
  console.log('[migrate-nav-subcats] 未配置数据库连接串，跳过');
} else if (/^postgres(ql)?:\/\//.test(primary || '')) {
  const results = [];
  if (primary) results.push(await migratePg('primary', primary));
  if (fallback && /^postgres(ql)?:\/\//.test(fallback)) results.push(await migratePg('fallback', fallback));
  console.log('[migrate-nav-subcats] 结果:', JSON.stringify(results));
} else {
  const url = primary || '';
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url || './data/blog.db';
  console.log('[migrate-nav-subcats] 结果:', JSON.stringify([await migrateSqlite(file)]));
}
