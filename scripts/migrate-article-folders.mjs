/** 构建前幂等升级主备 PostgreSQL 的文章分类表为嵌套目录。 */
import postgres from 'postgres';

const endpoints = [
  ['primary', process.env.DATABASE_URL],
  ['fallback', process.env.DATABASE_URL_FALLBACK],
].filter(([, url]) => typeof url === 'string' && /^postgres(ql)?:\/\//.test(url));

for (const [name, url] of endpoints) {
  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS article_categories (
      id text PRIMARY KEY,
      name text NOT NULL,
      color text NOT NULL DEFAULT '',
      sort integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS article_post_categories (
      article_id text PRIMARY KEY,
      category_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE article_categories ADD COLUMN IF NOT EXISTS parent_id text`;
    await sql`CREATE INDEX IF NOT EXISTS article_categories_parent_idx ON article_categories(parent_id)`;
    await sql`CREATE INDEX IF NOT EXISTS article_categories_sort_idx ON article_categories(sort)`;
    await sql`CREATE INDEX IF NOT EXISTS article_post_categories_category_idx ON article_post_categories(category_id)`;
    console.log(`[migrate-article-folders] ${name}: 目录层级列已就位`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
