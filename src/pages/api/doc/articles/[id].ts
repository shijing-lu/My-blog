/**
 * GET /api/doc/articles/[id] —— 单篇文章（公开，含正文供阅读）
 */
import type { APIRoute } from 'astro';
import { json, missing, notFound } from '@/lib/api';
import { getDocArticle } from '@/lib/docs';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  try {
    const article = await getDocArticle(id);
    if (!article) return notFound('文章不存在');
    return json({ article });
  } catch (err) {
    console.error('[api/doc/articles]', err);
    return json({ error: '读取失败' }, 500);
  }
};
