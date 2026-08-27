/**
 * 一次性脚本：本地 SQLite 建学习模式 3 张新表（study_sessions / study_tasks / study_distractions）
 * 用法：node scripts/create-study-tables.mjs
 * 说明：drizzle db:push:dev 因历史 likes 表漂移不可用，故直接建表；
 *       字段与 db/schema.sqlite.ts 保持一致（时间戳为毫秒整数）。
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
  study_sessions: `
    CREATE TABLE IF NOT EXISTS study_sessions (
      id text PRIMARY KEY NOT NULL,
      task_id text,
      duration_sec integer NOT NULL,
      completed integer DEFAULT 1 NOT NULL,
      created_at integer NOT NULL
    )`,
  study_tasks: `
    CREATE TABLE IF NOT EXISTS study_tasks (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL,
      est_pomodoros integer DEFAULT 1 NOT NULL,
      done integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )`,
  study_distractions: `
    CREATE TABLE IF NOT EXISTS study_distractions (
      id text PRIMARY KEY NOT NULL,
      type text NOT NULL,
      note text DEFAULT '' NOT NULL,
      created_at integer NOT NULL
    )`,
};

const indexes = [
  'CREATE INDEX IF NOT EXISTS study_sessions_task_idx ON study_sessions (task_id)',
  'CREATE INDEX IF NOT EXISTS study_sessions_created_idx ON study_sessions (created_at)',
  'CREATE INDEX IF NOT EXISTS study_tasks_created_idx ON study_tasks (created_at)',
  'CREATE INDEX IF NOT EXISTS study_distractions_created_idx ON study_distractions (created_at)',
];

db.exec('BEGIN');
try {
  for (const sql of Object.values(tables)) db.exec(sql);
  for (const sql of indexes) db.exec(sql);
  db.exec('COMMIT');
  console.log('OK: study tables created in', file);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('FAILED:', err);
  process.exitCode = 1;
}
