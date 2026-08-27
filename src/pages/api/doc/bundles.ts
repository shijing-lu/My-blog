/**
 * POST/PUT/DELETE /api/doc/bundles —— 文档管理（登录）
 *
 * POST:   { categoryId, name, icon?, summary?, sort? } → 201 { bundle }
 * PUT:    { id, name?, icon?, summary?, categoryId?, sort? } → { bundle }
 * DELETE: { id } → { ok }（级联删除其下文章）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { createDocBundle, deleteDocBundle, updateDocBundle } from '@/lib/docs';

export const prerender = false;

const MAX_NAME = 80;
const MAX_SUMMARY = 200;
const MAX_ICON = 20;

export const POST: APIRoute = async ({ request }) => {
  let body: { categoryId?: unknown; name?: unknown; icon?: unknown; summary?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { categoryId?: unknown; name?: unknown; icon?: unknown; summary?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : '';
  if (!categoryId) return json({ error: '缺少分类 ID' }, 400);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return json({ error: '请填写文档名' }, 400);
  const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  const summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, MAX_SUMMARY) : null;
  const sort = Number.isFinite(Number(body.sort)) ? Math.max(0, Math.floor(Number(body.sort))) : 0;
  try {
    const bundle = await createDocBundle({ categoryId, name, icon, summary, sort });
    return json({ bundle }, 201);
  } catch (err) {
    console.error('[api/doc/bundles]', err);
    return json({ error: '创建失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  let body: { id?: unknown; name?: unknown; icon?: unknown; summary?: unknown; categoryId?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; name?: unknown; icon?: unknown; summary?: unknown; categoryId?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return json({ error: '缺少文档 ID' }, 400);
  const patch: { name?: string; icon?: string | null; summary?: string | null; categoryId?: string; sort?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return json({ error: '文档名不能为空' }, 400);
    patch.name = name;
  }
  if (body.icon !== undefined) patch.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  if (body.summary !== undefined) patch.summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, MAX_SUMMARY) : null;
  if (body.categoryId !== undefined) {
    const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : '';
    if (!categoryId) return json({ error: '分类 ID 不合法' }, 400);
    patch.categoryId = categoryId;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const bundle = await updateDocBundle(id, patch);
    if (!bundle) return json({ error: '文档不存在' }, 404);
    return json({ bundle });
  } catch (err) {
    console.error('[api/doc/bundles]', err);
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
  if (!id) return json({ error: '缺少文档 ID' }, 400);
  try {
    await deleteDocBundle(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/doc/bundles]', err);
    return json({ error: '删除失败' }, 500);
  }
};
