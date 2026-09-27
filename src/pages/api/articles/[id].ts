/**
 * GET /api/articles/[id] —— 载入草稿 / 删除文章
 *
 * 服务端拦截模式下正文明文存库，管理端直接返回即可，无需密码解密。
 */
import type { APIRoute } from 'astro';
import { deleteArticle, getArticleById, saveDraft } from '@/lib/articles';
import { badJson, badRequest, guardManager, json, missing, notFound, readJson, serializeArticle } from '@/lib/api';

export const prerender = false;

/** 载入草稿 */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  const article = await getArticleById(id);
  if (!article) return notFound('文章不存在');

  return json({ article: serializeArticle(article) });
};

/** 共用原位编辑器只更新正文；其余文章属性始终以服务端最新值保存。 */
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<{ content?: unknown }>(request);
  if (!body) return badJson();
  if (typeof body.content !== 'string') return badRequest('正文必须是字符串');
  const current = await getArticleById(id);
  if (!current) return notFound('文章不存在');
  try {
    const saved = await saveDraft({
      id,
      title: current.title,
      type: current.type,
      summary: current.summary,
      cover: current.cover ?? '',
      tags: current.tags,
      content: body.content,
    });
    return json({ node: { updatedAt: saved.updatedAt.toISOString() } });
  } catch (error) {
    console.error('[api/articles/inline-save]', error);
    return json({ error: '保存失败' }, 500);
  }
};

/** 删除文章 */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  await deleteArticle(id);
  return json({ ok: true });
};
