/**
 * AI 小卿：惰性建表的**真实建库实测**（不污染全局环境）
 *
 * 历史坑（2026-09-21 实证）：本用例最初靠改 `process.env.DATABASE_URL` + 动态 import 来换库，
 * 结果同进程的其他测试文件（读真实文章的 TOC fixture）也跟着去查临时空库，出现 2 个
 * "莫名其妙"的失败。修法：`ai-store` 暴露可注入连接串的 `applyAiDdl(url)`，
 * 测试直接指向临时库，**完全不碰 process.env**。
 */
import { it, expect } from 'vitest';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { AI_TABLE_NAMES, applyAiDdl, ensureAiTables } from '../src/lib/ai-store';

it('applyAiDdl 在空 SQLite 库上建表且幂等，列/索引/布尔列类型正确', async () => {
  const DB_DIR = '.diag';
  const DB_FILE = `${DB_DIR}/ai-store-test.db`;
  mkdirSync(DB_DIR, { recursive: true });
  if (existsSync(DB_FILE)) unlinkSync(DB_FILE);

  try {
    // 建两次：验证 DDL 全为 IF NOT EXISTS（幂等，不丢数据）
    await applyAiDdl(`file:${DB_FILE}`);
    await applyAiDdl(`file:${DB_FILE}`);
    expect(existsSync(DB_FILE), '建表后库文件应存在').toBe(true);

    const db = new Database(DB_FILE, { readonly: true });
    const names = (sql: string): string[] =>
      (db.prepare(sql).all() as Array<{ name: string }>).map((r) => r.name);

    const tables = names("SELECT name FROM sqlite_master WHERE type='table'");
    for (const t of AI_TABLE_NAMES) expect(tables, `缺表 ${t}`).toContain(t);

    const indexes = names("SELECT name FROM sqlite_master WHERE type='index'");
    for (const idx of ['ai_conversations_updated_idx', 'ai_messages_conversation_idx', 'ai_memories_rank_idx']) {
      expect(indexes, `缺索引 ${idx}`).toContain(idx);
    }

    // 布尔列必须是 INTEGER 亲和（booleanFlag 约定：PG 侧才是原生 boolean）
    const cols = db.prepare('PRAGMA table_info(ai_conversations)').all() as Array<{ name: string; type: string }>;
    expect(cols.find((c) => c.name === 'summarized')?.type?.toUpperCase(), 'summarized 应为 INTEGER').toContain('INT');
    db.close();
  } finally {
    if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  }
}, 60_000);

it('ensureAiTables() 走真实入口（当前 DATABASE_URL）返回成功', async () => {
  // 这是 AI 端点在运行时调用的真实入口：库已存在表时同样返回 true（DDL 幂等）
  expect(await ensureAiTables()).toBe(true);
  expect(await ensureAiTables(), '进程内缓存：第二次直接返回 true').toBe(true);
}, 60_000);
