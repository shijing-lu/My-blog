/**
 * POST/PUT/DELETE /api/doc/categories —— 文档分类管理（登录）
 *
 * POST:   { name, sort? } → 201 { category }
 * PUT:    { id, name?, sort? } → { category }
 * DELETE: { id } → { ok }（级联删除其下文档与文章）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, json, notFound, readJson } from '@/lib/api';
import { createDocCategory, deleteDocCategory, updateDocCategory } from '@/lib/docs';

export const prerender = false;

const MAX_NAME = 50;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ name?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return badRequest('请填写分类名');
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
  const body = await readJson<{ id?: unknown; name?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少分类 ID');
  const patch: { name?: string; sort?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return badRequest('分类名不能为空');
    patch.name = name;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const category = await updateDocCategory(id, patch);
    if (!category) return notFound('分类不存在');
    return json({ category });
  } catch (err) {
    console.error('[api/doc/categories]', err);
    return json({ error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const body = await readJson<{ id?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少分类 ID');
  try {
    await deleteDocCategory(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/doc/categories]', err);
    return json({ error: '删除失败' }, 500);
  }
};
