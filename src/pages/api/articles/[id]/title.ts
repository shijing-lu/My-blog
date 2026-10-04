/** 首页文章标题独立更新，避免全文保存与标题自动保存发生覆盖。 */
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../db';
import { articles } from '../../../../../db/schema.sqlite';
import { badJson, badRequest, guardManager, json, missing, notFound, readJson } from '@/lib/api';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<{ title?: unknown }>(request);
  if (!body) return badJson();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 200) return badRequest('标题应为 1–200 个字符');
  const rows = await db.update(articles)
    .set({ title, published: true, updatedAt: new Date() })
    .where(eq(articles.id, id))
    .returning({ id: articles.id, title: articles.title, updatedAt: articles.updatedAt });
  return rows[0] ? json({ article: rows[0] }) : notFound('文章不存在');
};
