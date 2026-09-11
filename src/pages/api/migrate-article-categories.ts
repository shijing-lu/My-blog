/**
 * POST /api/migrate-article-categories —— 一次性迁移：写作台自定义分类两表建表（管理员）
 *
 * 背景：写作台的「自定义分类」功能需要两张新表（`article_categories`、`article_post_categories`）。
 * 生产连接串被 Vercel 标记为 Sensitive、本地拿不到明文，无法直连执行 DDL，故沿用既有
 * 模式提供迁移端点，借生产函数运行时的环境变量完成建表。
 *
 * 用法：管理员登录后 POST 本端点一次即可；**幂等**，可重复执行。
 * 未执行迁移前业务代码对两表查询均做缺表容错（见 `src/lib/article-categories.ts`），
 * 表现为「分类功能不可用」，不会 500。
 *
 * 迁移确认成功后可删除本文件（同时移除 middleware.ts 中的保护条目）。
 */
import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { json, unauthorized } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';

export const prerender = false;

export const config = { maxDuration: 60 };

/** 建表语句（PostgreSQL；CREATE TABLE IF NOT EXISTS 幂等） */
const DDL_LIST: Array<{ name: string; ddl: string }> = [
  {
    name: 'article_categories',
    ddl: `CREATE TABLE IF NOT EXISTS article_categories (
      id text PRIMARY KEY,
      name text NOT NULL,
      color text NOT NULL DEFAULT '',
      sort integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
  {
    name: 'article_categories_sort_idx',
    ddl: 'CREATE INDEX IF NOT EXISTS article_categories_sort_idx ON article_categories (sort)',
  },
  {
    name: 'article_post_categories',
    ddl: `CREATE TABLE IF NOT EXISTS article_post_categories (
      article_id text PRIMARY KEY,
      category_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
  {
    name: 'article_post_categories_category_idx',
    ddl: 'CREATE INDEX IF NOT EXISTS article_post_categories_category_idx ON article_post_categories (category_id)',
  },
];

async function migrateUrl(label: string, url: string): Promise<Record<string, unknown>> {
  const client = postgres(url, { max: 1, connect_timeout: 15 });
  const done: string[] = [];
  try {
    for (const item of DDL_LIST) {
      await client.unsafe(item.ddl);
      done.push(item.name);
    }
    // 复核两张表确实存在
    const tables = await client.unsafe<{ table_name: string }[]>(
      "SELECT table_name FROM information_schema.tables WHERE table_name IN ('article_categories', 'article_post_categories')",
    );
    return { target: label, ok: true, applied: done, tableCount: tables.length };
  } catch (err) {
    return { target: label, ok: false, applied: done, error: (err as Error).message };
  } finally {
    await client.end({ timeout: 5 });
  }
}

export const POST: APIRoute = async (context) => {
  if (!(await isManagerSession(context.cookies))) return unauthorized('未登录');

  const primaryUrl = process.env.DATABASE_URL;
  const fallbackUrl = process.env.DATABASE_URL_FALLBACK;
  if (!primaryUrl || !/^postgres(ql)?:\/\//.test(primaryUrl)) {
    return json({ error: '缺少 DATABASE_URL' }, 500);
  }

  const results = [await migrateUrl('primary', primaryUrl)];
  if (fallbackUrl && /^postgres(ql)?:\/\//.test(fallbackUrl)) {
    results.push(await migrateUrl('fallback', fallbackUrl));
  }

  const allOk = results.every((r) => r.ok);
  return json({ ok: allOk, applied: DDL_LIST.map((d) => d.name), results }, allOk ? 200 : 500);
};
