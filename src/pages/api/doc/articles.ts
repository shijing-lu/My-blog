/**
 * POST/PUT/DELETE /api/doc/articles —— 文档文章管理（登录）
 *
 * POST:   { bundleId, title, content, sort? } → 201 { article }
 * PUT:    { id, title?, content?, bundleId?, sort? } → { article }
 * DELETE: { id } → { ok }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { createDocArticle, deleteDocArticle, updateDocArticle } from '@/lib/docs';

export const prerender = false;

const MAX_TITLE = 200;
const MAX_CONTENT = 200_000;

export const POST: APIRoute = async ({ request }) => {
  let body: { bundleId?: unknown; title?: unknown; content?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { bundleId?: unknown; title?: unknown; content?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const bundleId = typeof body.bundleId === 'string' && body.bundleId.trim() ? body.bundleId.trim() : '';
  if (!bundleId) return json({ error: '缺少文档 ID' }, 400);
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  if (!title) return json({ error: '请填写标题' }, 400);
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
  let body: { id?: unknown; title?: unknown; content?: unknown; bundleId?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; title?: unknown; content?: unknown; bundleId?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return json({ error: '缺少文章 ID' }, 400);
  const patch: { title?: string; content?: string; bundleId?: string; sort?: number } = {};
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
    if (!title) return json({ error: '标题不能为空' }, 400);
    patch.title = title;
  }
  if (body.content !== undefined) patch.content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
  if (body.bundleId !== undefined) {
    const bundleId = typeof body.bundleId === 'string' && body.bundleId.trim() ? body.bundleId.trim() : '';
    if (!bundleId) return json({ error: '文档 ID 不合法' }, 400);
    patch.bundleId = bundleId;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const article = await updateDocArticle(id, patch);
    if (!article) return json({ error: '文章不存在' }, 404);
    return json({ article });
  } catch (err) {
    console.error('[api/doc/articles]', err);
    return json({ error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return json({ error: '缺少文章 ID' }, 400);
  try {
    const article = await deleteDocArticle(id);
    if (!article) return json({ error: '文章不存在' }, 404);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/doc/articles]', err);
    return json({ error: '删除失败' }, 500);
  }
};
