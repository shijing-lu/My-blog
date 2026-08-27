/**
 * 一次性脚本：本地 SQLite 建学习打卡 2 张新表
 * 用法：node scripts/create-checkin-tables.mjs
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
  checkin_tasks: `
    CREATE TABLE IF NOT EXISTS checkin_tasks (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      icon text,
      max_makeup_days integer DEFAULT 1 NOT NULL,
      sort integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL
    )`,
  checkin_records: `
    CREATE TABLE IF NOT EXISTS checkin_records (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      date text NOT NULL,
      created_at integer NOT NULL
    )`,
};

const indexes = [
  'CREATE INDEX IF NOT EXISTS checkin_tasks_sort_idx ON checkin_tasks (sort)',
  'CREATE UNIQUE INDEX IF NOT EXISTS checkin_records_task_date_unique ON checkin_records (task_id, date)',
  'CREATE INDEX IF NOT EXISTS checkin_records_task_idx ON checkin_records (task_id)',
];

db.exec('BEGIN');
try {
  for (const sql of Object.values(tables)) db.exec(sql);
  for (const sql of indexes) db.exec(sql);
  db.exec('COMMIT');
  console.log('OK: checkin tables created in', file);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('FAILED:', err);
  process.exitCode = 1;
}
