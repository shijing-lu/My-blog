/**
 * /api/article-categories —— 写作台自定义分类（管理员）
 *
 * GET    → { categories, map: { articleId: categoryId } }（缺失表时返回空，功能降级）
 * POST   { name, color? }                    → 新建分类（追加末尾）→ 201
 * PATCH  { id, name?, color? }               → 重命名 / 改色
 *        { ids: string[] }                   → 整序重排（按数组顺序重写 sort）
 *        { articleId, categoryId|null }      → 设置文章归属（null/"" = 解除）
 * DELETE { id }                              → 删除分类（解除其下文章归属，不删文章）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, readJson } from '@/lib/api';
import {
  articleCategoryMap,
  createArticleCategory,
  deleteArticleCategory,
  listArticleCategories,
  reorderArticleCategories,
  setArticleCategory,
  updateArticleCategory,
} from '@/lib/article-categories';

export const prerender = false;

const MAX_NAME = 30;
const MAX_COLOR = 24;

export const GET: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const [categories, map] = await Promise.all([listArticleCategories(), articleCategoryMap()]);
  return json(
    { categories, map: Object.fromEntries(map) },
    { headers: { 'cache-control': 'no-store' } },
  );
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ name?: unknown; color?: unknown }>(request);
  if (!body) return badJson();
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return badRequest('请填写分类名');
  // 重名直接拒绝：写作台左栏按名分组，重名会让用户分不清
  const exists = await listArticleCategories();
  if (exists.some((c) => c.name === name)) return json({ error: `已存在分类「${name}」` }, 400);
  const color = typeof body.color === 'string' ? body.color.trim().slice(0, MAX_COLOR) : '';
  const category = await createArticleCategory(name, color);
  if (!category) return json({ error: '创建失败（分类表可能尚未迁移，请执行迁移端点）' }, 500);
  return json({ category }, 201);
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{
    id?: unknown;
    name?: unknown;
    color?: unknown;
    ids?: unknown;
    articleId?: unknown;
    categoryId?: unknown;
  }>(request);
  if (!body) return badJson();

  /* 重排：{ ids: [...] } */
  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((x): x is string => typeof x === 'string');
    const ok = await reorderArticleCategories(ids);
    return json({ ok }, ok ? 200 : 500);
  }

  /* 文章归属：{ articleId, categoryId } */
  if (typeof body.articleId === 'string' && body.articleId) {
    const articleId = body.articleId;
    const raw = typeof body.categoryId === 'string' ? body.categoryId : '';
    const ok = await setArticleCategory(articleId, raw || null);
    return json({ ok }, ok ? 200 : 500);
  }

  /* 重命名 / 改色：{ id, name?, color? } */
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return badRequest('缺少分类 id');
  const patch: { name?: string; color?: string } = {};
  if (typeof body.name === 'string') {
    const n = body.name.trim().slice(0, MAX_NAME);
    if (!n) return badRequest('分类名不能为空');
    const all = await listArticleCategories();
    if (all.some((c) => c.name === n && c.id !== id)) return json({ error: `已存在分类「${n}」` }, 400);
    patch.name = n;
  }
  if (typeof body.color === 'string') patch.color = body.color.trim().slice(0, MAX_COLOR);
  const ok = await updateArticleCategory(id, patch);
  return json({ ok }, ok ? 200 : 500);
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ id?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return badRequest('缺少分类 id');
  const ok = await deleteArticleCategory(id);
  return json({ ok }, ok ? 200 : 500);
};
