/**
 * POST/PUT/DELETE /api/doc/bundles —— 文档管理（登录）
 *
 * POST:   { categoryId, name, icon?, summary?, sort? } → 201 { bundle }
 * PUT:    { id, name?, icon?, summary?, categoryId?, sort? } → { bundle }
 * DELETE: { id } → { ok }（级联删除其下文章）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, json, notFound, readJson } from '@/lib/api';
import { createDocBundle, deleteDocBundle, updateDocBundle } from '@/lib/docs';

export const prerender = false;

const MAX_NAME = 80;
const MAX_SUMMARY = 200;
const MAX_ICON = 20;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ categoryId?: unknown; name?: unknown; icon?: unknown; summary?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : '';
  if (!categoryId) return badRequest('缺少分类 ID');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return badRequest('请填写文档名');
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
  const body = await readJson<{ id?: unknown; name?: unknown; icon?: unknown; summary?: unknown; categoryId?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少文档 ID');
  const patch: { name?: string; icon?: string | null; summary?: string | null; categoryId?: string; sort?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return badRequest('文档名不能为空');
    patch.name = name;
  }
  if (body.icon !== undefined) patch.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  if (body.summary !== undefined) patch.summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, MAX_SUMMARY) : null;
  if (body.categoryId !== undefined) {
    const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : '';
    if (!categoryId) return badRequest('分类 ID 不合法');
    patch.categoryId = categoryId;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const bundle = await updateDocBundle(id, patch);
    if (!bundle) return notFound('文档不存在');
    return json({ bundle });
  } catch (err) {
    console.error('[api/doc/bundles]', err);
    return json({ error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const body = await readJson<{ id?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少文档 ID');
  try {
    await deleteDocBundle(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/doc/bundles]', err);
    return json({ error: '删除失败' }, 500);
  }
};
