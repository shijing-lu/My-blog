/**
 * AI 小卿：惰性建表的**真实换库实测**（独立文件，靠 vitest 的按文件模块隔离）
 *
 * 为什么单独成文件：`db/dialect.ts` 的 `isDesktopMode` 是**模块加载时**求值的常量，
 * 且非桌面模式下 `readDatabaseUrl()` 是 `.env` 文件值优先；在同一文件里先加载过
 * dialect 再改 env 是无效的。故这里：设 env → 动态 import → 实测建表。
 */
import { it, expect } from 'vitest';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

it('ensureAiTables 在空 SQLite 库上幂等建表，且列/索引齐全', async () => {
  const DB_DIR = '.diag';
  const DB_FILE = `${DB_DIR}/ai-store-test.db`;
  mkdirSync(DB_DIR, { recursive: true });
  if (existsSync(DB_FILE)) unlinkSync(DB_FILE);

  const prevUrl = process.env.DATABASE_URL;
  const prevDesktop = process.env.DESKTOP_MODE;
  process.env.DESKTOP_MODE = '1';
  process.env.DATABASE_URL = `file:${DB_FILE}`;

  try {
    const store = await import('../src/lib/ai-store');
    store.__resetEnsureFlagForTest();

    expect(await store.ensureAiTables(), '首次建表应成功').toBe(true);
    expect(await store.ensureAiTables(), '幂等：第二次仍返回成功').toBe(true);
    expect(existsSync(DB_FILE), '建表后库文件应存在').toBe(true);

    const db = new Database(DB_FILE, { readonly: true });
    const names = (sql: string): string[] =>
      (db.prepare(sql).all() as Array<{ name: string }>).map((r) => r.name);

    const tables = names("SELECT name FROM sqlite_master WHERE type='table'");
    for (const t of store.AI_TABLE_NAMES) expect(tables, `缺表 ${t}`).toContain(t);

    const indexes = names("SELECT name FROM sqlite_master WHERE type='index'");
    for (const idx of ['ai_conversations_updated_idx', 'ai_messages_conversation_idx', 'ai_memories_rank_idx']) {
      expect(indexes, `缺索引 ${idx}`).toContain(idx);
    }

    // 抽查一列：booleanFlag 在 SQLite 侧应为 integer 亲和（不是 text）
    const bondCols = db.prepare('PRAGMA table_info(ai_conversations)').all() as Array<{ name: string; type: string }>;
    const summarized = bondCols.find((c) => c.name === 'summarized');
    expect(summarized?.type?.toUpperCase(), 'summarized 应为 INTEGER（booleanFlag 约定）').toContain('INT');
    db.close();
  } finally {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevDesktop === undefined) delete process.env.DESKTOP_MODE;
    else process.env.DESKTOP_MODE = prevDesktop;
    if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  }
}, 60_000);
