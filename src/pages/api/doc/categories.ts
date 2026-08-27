/**
 * POST/PUT/DELETE /api/doc/categories —— 文档分类管理（登录）
 *
 * POST:   { name, sort? } → 201 { category }
 * PUT:    { id, name?, sort? } → { category }
 * DELETE: { id } → { ok }（级联删除其下文档与文章）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { createDocCategory, deleteDocCategory, updateDocCategory } from '@/lib/docs';

export const prerender = false;

const MAX_NAME = 50;

export const POST: APIRoute = async ({ request }) => {
  let body: { name?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return json({ error: '请填写分类名' }, 400);
  const sort = Number.isFinite(Number(body.sort)) ? Math.max(0, Math.floor(Number(body.sort))) : 0;
  try {
    const category = await createDocCategory(name, sort);
    return json({ category }, 201);
  } catch (err) {
    console.error('[api/doc/categories]', err);
    return json({ error: '创建失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  let body: { id?: unknown; name?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; name?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return json({ error: '缺少分类 ID' }, 400);
  const patch: { name?: string; sort?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return json({ error: '分类名不能为空' }, 400);
    patch.name = name;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const category = await updateDocCategory(id, patch);
    if (!category) return json({ error: '分类不存在' }, 404);
    return json({ category });
  } catch (err) {
    console.error('[api/doc/categories]', err);
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
  if (!id) return json({ error: '缺少分类 ID' }, 400);
  try {
    await deleteDocCategory(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/doc/categories]', err);
    return json({ error: '删除失败' }, 500);
  }
};
