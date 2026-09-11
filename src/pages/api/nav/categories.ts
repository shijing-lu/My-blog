/**
 * POST/PUT/DELETE /api/nav/categories —— 分类管理（管理员）
 *
 * POST:   { name, icon?, sort? } → 201 { category }
 * PUT:    { id, name?, icon?, sort? } → { category }
 * DELETE: { id } → { ok }（级联删除其下网站）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, notFound, readJson } from '@/lib/api';
import { createCategory, deleteCategory, updateCategory } from '@/lib/nav';

export const prerender = false;

const MAX_NAME = 50;
const MAX_ICON = 20;

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ name?: unknown; icon?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return badRequest('请填写分类名');
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
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ id?: unknown; name?: unknown; icon?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少分类 ID');
  const patch: { name?: string; icon?: string | null; sort?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return badRequest('分类名不能为空');
    patch.name = name;
  }
  if (body.icon !== undefined) {
    patch.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const category = await updateCategory(id, patch);
    if (!category) return notFound('分类不存在');
    return json({ category });
  } catch (err) {
    console.error('[api/nav/categories]', err);
    return json({ error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ id?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少分类 ID');
  try {
    await deleteCategory(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/nav/categories]', err);
    return json({ error: '删除失败' }, 500);
  }
};
