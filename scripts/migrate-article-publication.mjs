/** 构建前迁移主备 PostgreSQL：旧文章默认已发布，新文章由应用写入草稿状态。 */
import postgres from 'postgres';

const endpoints = [
  ['primary', process.env.DATABASE_URL],
  ['fallback', process.env.DATABASE_URL_FALLBACK],
].filter(([, url]) => typeof url === 'string' && /^postgres(ql)?:\/\//.test(url));

for (const [name, url] of endpoints) {
  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true`;
    console.log(`[migrate-article-publication] ${name}: published 已就位`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
