/**
 * 数据库查看脚本（pnpm db:inspect）
 *
 * 以只读方式打开 SQLite（data/blog.db），打印表结构与文章/图片概览。
 * 仅用于开发环境查看数据；生产库请用 Drizzle Studio 或 SQL 客户端。
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DATABASE_URL?.startsWith('postgres')
  ? null
  : process.env.DATABASE_URL?.startsWith('file:')
    ? join(root, process.env.DATABASE_URL.slice('file:'.length))
    : join(root, 'data/blog.db');

if (!dbPath || process.env.DATABASE_URL?.startsWith('postgres')) {
  console.log('当前 DATABASE_URL 指向 PostgreSQL，请用 Drizzle Studio 或 SQL 客户端查看。');
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true });

console.log(`\n数据库文件：${dbPath}\n`);
console.log('=== 表 ===');
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
console.log(tables.join(', ') || '(空)');

if (tables.includes('articles')) {
  console.log('\n=== articles（前 5 行，长字段显示长度） ===');
  console.table(
    db
      .prepare(
        "SELECT id, title, type, slug, length(content) AS content_chars, summary, tags, datetime(updated_at/1000,'unixepoch','localtime') AS updated_at FROM articles ORDER BY updated_at DESC LIMIT 5",
      )
      .all(),
  );
  console.log('文章总数：', db.prepare('SELECT COUNT(*) AS n FROM articles').get().n);
}

if (tables.includes('images')) {
  console.log('\n=== images ===');
  console.table(
    db
      .prepare(
        "SELECT id, mime, length(data) AS data_chars, datetime(created_at/1000,'unixepoch','localtime') AS created_at FROM images",
      )
      .all(),
  );
  console.log('图片总数：', db.prepare('SELECT COUNT(*) AS n FROM images').get().n);
}

db.close();
