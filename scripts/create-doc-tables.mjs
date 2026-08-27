/**
 * 一次性脚本：本地 SQLite 建文档系统 3 张新表
 * 用法：node scripts/create-doc-tables.mjs
 * 字段与 db/schema.sqlite.ts 保持一致（时间戳为毫秒整数）。
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const match = env.match(/^DATABASE_URL=(.+)$/m);
const url = match ? match[1].trim() : 'file:./data/blog.db';
const file = url.startsWith('file:') ? url.slice('file:'.length) : url;
const db = new Database(join(root, file));

const tables = {
  doc_categories: `
    CREATE TABLE IF NOT EXISTS doc_categories (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      sort integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL
    )`,
  doc_bundles: `
    CREATE TABLE IF NOT EXISTS doc_bundles (
      id text PRIMARY KEY NOT NULL,
      category_id text NOT NULL,
      name text NOT NULL,
      icon text,
      summary text,
      sort integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL
    )`,
  doc_articles: `
    CREATE TABLE IF NOT EXISTS doc_articles (
      id text PRIMARY KEY NOT NULL,
      bundle_id text NOT NULL,
      title text NOT NULL,
      content text DEFAULT '' NOT NULL,
      sort integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )`,
};

const indexes = [
  'CREATE INDEX IF NOT EXISTS doc_categories_sort_idx ON doc_categories (sort)',
  'CREATE INDEX IF NOT EXISTS doc_bundles_category_idx ON doc_bundles (category_id)',
  'CREATE INDEX IF NOT EXISTS doc_bundles_sort_idx ON doc_bundles (sort)',
  'CREATE INDEX IF NOT EXISTS doc_articles_bundle_idx ON doc_articles (bundle_id)',
  'CREATE INDEX IF NOT EXISTS doc_articles_sort_idx ON doc_articles (sort)',
];

db.exec('BEGIN');
try {
  for (const sql of Object.values(tables)) db.exec(sql);
  for (const sql of indexes) db.exec(sql);
  db.exec('COMMIT');
  console.log('OK: doc tables created in', file);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('FAILED:', err);
  process.exitCode = 1;
}
