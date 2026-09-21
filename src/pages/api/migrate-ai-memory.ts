/**
 * POST /api/migrate-ai-memory —— 幂等建表：AI 小卿 4 张表（管理员）
 *
 * 用途：生产巡检 / 显式迁移。**日常运行不依赖它**——AI 端点首调时会经
 * `ensureAiTables()` 自动建表（见 `src/lib/ai-store.ts`），本端点只是给运维一个
 * 「明确知道现在建没建」的入口，并复用同一份 DDL（单一事实来源，避免两处漂移）。
 *
 * 用法：管理员登录后 POST 一次即可；**幂等**，可重复执行。
 * 只对 PostgreSQL 生效（本地/桌面端是 SQLite，由 ensureAiTables 负责）。
 */
import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { json, unauthorized } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';
import { AI_DDL_PG, AI_TABLE_NAMES } from '@/lib/ai-store';

export const prerender = false;

export const config = { maxDuration: 60 };

/** 在某个 PG 端点上执行建表并复核表数 */
async function migrateUrl(label: string, url: string): Promise<Record<string, unknown>> {
  const client = postgres(url, { max: 1, connect_timeout: 15 });
  const done: string[] = [];
  try {
    for (const ddl of AI_DDL_PG) {
      await client.unsafe(ddl);
      done.push(ddl.split('\n')[0]!.replace(/\s+/g, ' ').slice(0, 60));
    }
    const tables = await client.unsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_name IN (${AI_TABLE_NAMES.map((n) => `'${n}'`).join(', ')})`,
    );
    return { target: label, ok: tables.length === AI_TABLE_NAMES.length, applied: done.length, tableCount: tables.length };
  } catch (err) {
    return { target: label, ok: false, applied: done.length, error: (err as Error).message };
  } finally {
    await client.end({ timeout: 5 });
  }
}

export const POST: APIRoute = async (context) => {
  if (!(await isManagerSession(context.cookies))) return unauthorized('未登录');

  const primaryUrl = process.env.DATABASE_URL;
  const fallbackUrl = process.env.DATABASE_URL_FALLBACK;
  if (!primaryUrl || !/^postgres(ql)?:\/\//.test(primaryUrl)) {
    return json({ error: '缺少 DATABASE_URL（本端点仅用于 PostgreSQL 生产库）' }, 500);
  }

  const results = [await migrateUrl('primary', primaryUrl)];
  if (fallbackUrl && /^postgres(ql)?:\/\//.test(fallbackUrl)) {
    results.push(await migrateUrl('fallback', fallbackUrl));
  }

  const allOk = results.every((r) => r.ok);
  return json({ ok: allOk, tables: AI_TABLE_NAMES, results }, allOk ? 200 : 500);
};
