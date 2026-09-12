/**
 * 构建期幂等迁移：新建 article_views 表（主备双库）。
 *
 * 背景：归档页需要展示「x 阅读」，而 articles 表原本没有任何阅读/浏览字段，
 * 故新增独立的 article_views 流水表（一次访问一行，不做去重）。
 *
 * Vercel 生产环境变量标记为 Sensitive，CLI/API 读不到明文，
 * 本地无法直连生产库跑 DDL；因此挂在 `pnpm build` 前执行，
 * 每次部署自动保证 schema 就位，幂等可重复跑。
 * （与 migrate-moments-visibility.mjs / migrate-photos-tags.mjs 同一模式。）
 *
 * 行为约定（此脚本**永不抛错**，避免阻塞部署）：
 * - DATABASE_URL 非 postgres:// 时（本地 SQLite 开发）直接跳过
 * - 单个端点失败只打日志，继续处理另一个端点
 */
import postgres from 'postgres';

/** 建表：与 db/schema.pg.ts 的 article_views 定义保持一致 */
const DDL_TABLE = `CREATE TABLE IF NOT EXISTS "article_views" (
  "id" text PRIMARY KEY NOT NULL,
  "article_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
)`;

/** 索引：服务于单篇统计与归档页批量 IN + GROUP BY 聚合 */
const DDL_INDEX = `CREATE INDEX IF NOT EXISTS "article_views_article_idx" ON "article_views" ("article_id")`;

async function migrateEndpoint(name, url) {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.log(`[migrate-article-views] ${name}: 非 PG 连接串，跳过`);
    return { name, skipped: true };
  }
  const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
  try {
    await sql.unsafe(DDL_TABLE);
    await sql.unsafe(DDL_INDEX);
    // 双确认：表与索引都真的存在（只建了表没建索引也算未通过）
    const tableCheck = await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'article_views'`;
    const idxCheck = await sql`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'article_views' AND indexname = 'article_views_article_idx'`;
    const ok = tableCheck[0]?.n > 0 && idxCheck[0]?.n > 0;
    console.log(`[migrate-article-views] ${name}: ${ok ? '✓ article_views 表与索引就位' : '⚠ 校验未通过'}`);
    return { name, ok };
  } catch (err) {
    console.warn(`[migrate-article-views] ${name}: 迁移失败 - ${err.message}`);
    return { name, error: err.message };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const primary = process.env.DATABASE_URL;
const fallback = process.env.DATABASE_URL_FALLBACK;

if (!primary && !fallback) {
  console.log('[migrate-article-views] 未配置数据库连接串，跳过');
} else {
  const results = [];
  if (primary) results.push(await migrateEndpoint('primary', primary));
  if (fallback) results.push(await migrateEndpoint('fallback', fallback));
  console.log('[migrate-article-views] 结果:', JSON.stringify(results));
}
