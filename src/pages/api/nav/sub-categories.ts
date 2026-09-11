/**
 * POST/PUT/DELETE /api/nav/sub-categories —— 子分类管理（管理员）
 *
 * 子分类是主分类下的二级分组，只在该主分类的内容面板内呈现，不进分类列表。
 *
 * POST:   { categoryId, name, sort? } → 201 { subCategory }
 * PUT:    { id, name?, sort? } → { subCategory }
 * DELETE: { id } → { ok }（其下网站回到主分类「未分组」区，不删网站）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, notFound, readJson } from '@/lib/api';
import {
  createSubCategory,
  deleteSubCategory,
  getSubCategory,
  listSubCategories,
  updateSubCategory,
} from '@/lib/nav';

export const prerender = false;

const MAX_NAME = 50;

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ categoryId?: unknown; name?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!categoryId) return badRequest('缺少主分类');
  if (!name) return badRequest('请填写子分类名');
  // sort 省略时追加到末尾（取当前最大值 +1），保证新分组排在已有分组之后
  let sort = Number.isFinite(Number(body.sort)) ? Math.max(0, Math.floor(Number(body.sort))) : 0;
  if (body.sort === undefined) {
    const existing = await listSubCategories(categoryId);
    sort = existing.length;
  }
  try {
    const subCategory = await createSubCategory({ categoryId, name, sort });
    return json({ subCategory }, 201);
  } catch (err) {
    console.error('[api/nav/sub-categories]', err);
    return json({ error: '创建失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ id?: unknown; name?: unknown; sort?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少子分类 ID');
  const patch: { name?: string; sort?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return badRequest('子分类名不能为空');
    patch.name = name;
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) {
    patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  }
  try {
    const subCategory = await updateSubCategory(id, patch);
    if (!subCategory) return notFound('子分类不存在');
    return json({ subCategory });
  } catch (err) {
    console.error('[api/nav/sub-categories]', err);
    return json({ error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ id?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return badRequest('缺少子分类 ID');
  try {
    const existing = await getSubCategory(id);
    if (!existing) return notFound('子分类不存在');
    await deleteSubCategory(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/nav/sub-categories]', err);
    return json({ error: '删除失败' }, 500);
  }
};
