/**
 * POST/PUT/DELETE /api/nav/categories —— 分类管理（管理员）
 *
 * POST:   { name, icon?, sort? } → 201 { category }
 * PUT:    { id, name?, icon?, sort? } → { category }
 * DELETE: { id } → { ok }（级联删除其下网站）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { createCategory, deleteCategory, updateCategory } from '@/lib/nav';

export const prerender = false;

const MAX_NAME = 50;
const MAX_ICON = 20;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  let body: { name?: unknown; icon?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; icon?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return json({ error: '请填写分类名' }, 400);
  const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  const sort = Number.isFinite(Number(body.sort)) ? Math.max(0, Math.floor(Number(body.sort))) : 0;
  try {
    const category = await createCategory({ name, icon, sort });
    return json({ category }, 201);
  } catch (err) {
    console.error('[api/nav/categories]', err);
    return json({ error: '创建失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  let body: { id?: unknown; name?: unknown; icon?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; name?: unknown; icon?: unknown; sort?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return json({ error: '缺少分类 ID' }, 400);
  const patch: { name?: string; icon?: string | null; sort?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return json({ error: '分类名不能为空' }, 400);
    patch.name = name;
  }
  if (body.icon !== undefined) {
    patch.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const category = await updateCategory(id, patch);
    if (!category) return json({ error: '分类不存在' }, 404);
    return json({ category });
  } catch (err) {
    console.error('[api/nav/categories]', err);
    return json({ error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return json({ error: '缺少分类 ID' }, 400);
  try {
    await deleteCategory(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/nav/categories]', err);
    return json({ error: '删除失败' }, 500);
  }
};
