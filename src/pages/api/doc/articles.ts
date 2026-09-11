/**
 * POST/PUT/DELETE /api/doc/articles —— 文档文章管理（登录）
 *
 * POST:   { bundleId, title, content, sort? } → 201 { article }
 * PUT:    { id, title?, content?, bundleId?, sort? } → { article }
 * DELETE: { id } → { ok }
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, json, notFound, readJson } from '@/lib/api';
import { createDocArticle, deleteDocArticle, updateDocArticle } from '@/lib/docs';

export const prerender = false;

const MAX_TITLE = 200;
const MAX_CONTENT = 200_000;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ bundleId?: unknown; title?: unknown; content?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const bundleId = typeof body.bundleId === 'string' && body.bundleId.trim() ? body.bundleId.trim() : '';
  if (!bundleId) return badRequest('缺少文档 ID');
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  if (!title) return badRequest('请填写标题');
  const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
  const sort = Number.isFinite(Number(body.sort)) ? Math.max(0, Math.floor(Number(body.sort))) : 0;
  try {
    const article = await createDocArticle({ bundleId, title, content, sort });
    return json({ article }, 201);
  } catch (err) {
    console.error('[api/doc/articles]', err);
    return json({ error: '创建失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const body = await readJson<{ id?: unknown; title?: unknown; content?: unknown; bundleId?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少文章 ID');
  const patch: { title?: string; content?: string; bundleId?: string; sort?: number } = {};
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
    if (!title) return badRequest('标题不能为空');
    patch.title = title;
  }
  if (body.content !== undefined) patch.content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
  if (body.bundleId !== undefined) {
    const bundleId = typeof body.bundleId === 'string' && body.bundleId.trim() ? body.bundleId.trim() : '';
    if (!bundleId) return badRequest('文档 ID 不合法');
    patch.bundleId = bundleId;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const article = await updateDocArticle(id, patch);
    if (!article) return notFound('文章不存在');
    return json({ article });
  } catch (err) {
    console.error('[api/doc/articles]', err);
    return json({ error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const body = await readJson<{ id?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少文章 ID');
  try {
    const article = await deleteDocArticle(id);
    if (!article) return notFound('文章不存在');
    return json({ ok: true });
  } catch (err) {
    console.error('[api/doc/articles]', err);
    return json({ error: '删除失败' }, 500);
  }
};
