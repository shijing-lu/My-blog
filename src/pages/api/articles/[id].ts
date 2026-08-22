/**
 * GET/DELETE /api/articles/[id] —— 载入草稿 / 删除文章
 */
import type { APIRoute } from 'astro';
import { deleteArticle, getArticleById } from '@/lib/articles';
import { json, serializeArticle } from '@/lib/api';

export const prerender = false;

/** 载入草稿 */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const article = await getArticleById(id);
  if (!article) return json({ error: '文章不存在' }, 404);
  return json({ article: serializeArticle(article) });
};

/** 删除文章 */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  await deleteArticle(id);
  return json({ ok: true });
};
