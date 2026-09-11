/**
 * POST /api/mindmaps/generate —— 从文章标题结构自动生成导图骨架（管理员）
 *
 * body: { articleId, title? }
 * → 201 { map: { id, title, articleId } }（data 为自动生成的骨架）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, notFound, readJson } from '@/lib/api';
import { getArticleById } from '@/lib/articles';
import { createMindmap, generateFromArticleMarkdown } from '@/lib/mindmaps';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ articleId?: unknown; title?: unknown }>(request);
  if (!body) return badJson();

  const articleId = typeof body.articleId === 'string' && body.articleId.trim() ? body.articleId.trim() : '';
  if (!articleId) return badRequest('缺少文章 ID');

  try {
    const article = await getArticleById(articleId);
    if (!article) return notFound('文章不存在');

    const title = (typeof body.title === 'string' && body.title.trim() ? body.title.trim() : article.title).slice(0, 100);
    const data = generateFromArticleMarkdown(title, article.content);

    const map = await createMindmap({ title, articleId: article.id, data });
    return json(
      { map: { id: map.id, title: map.title, articleId: map.articleId, updatedAt: map.updatedAt.toISOString() } },
      201,
    );
  } catch (err) {
    console.error('[api/mindmaps/generate]', err);
    return json({ error: '生成失败' }, 500);
  }
};
