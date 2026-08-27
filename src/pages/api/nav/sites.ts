/**
 * POST/PUT/DELETE /api/nav/sites —— 网站管理（管理员）
 *
 * POST:   { categoryId, name, url, icon?, desc?, sort? } → 201 { website }
 * PUT:    { id, categoryId?, name?, url?, icon?, desc?, sort? } → { website }
 *         （改 categoryId 即「移动分类」）
 * DELETE: { id } → { ok }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { createWebsite, deleteWebsite, updateWebsite } from '@/lib/nav';

export const prerender = false;

const MAX_NAME = 80;
const MAX_URL = 300;
const MAX_ICON = 500;
const MAX_DESC = 200;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  let body: { categoryId?: unknown; name?: unknown; url?: unknown; icon?: unknown; desc?: unknown; sort?: unknown };
  try {
    body = (await request.json()) as {
      categoryId?: unknown;
      name?: unknown;
      url?: unknown;
      icon?: unknown;
      desc?: unknown;
      sort?: unknown;
    };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const categoryId = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  const url = typeof body.url === 'string' ? body.url.trim().slice(0, MAX_URL) : '';
  if (!categoryId) return json({ error: '请选择分类' }, 400);
  if (!name) return json({ error: '请填写网站名' }, 400);
  if (!url) return json({ error: '请填写网址' }, 400);
  const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  const desc = typeof body.desc === 'string' && body.desc.trim() ? body.desc.trim().slice(0, MAX_DESC) : null;
  const sort = Number.isFinite(Number(body.sort)) ? Math.max(0, Math.floor(Number(body.sort))) : 0;
  try {
    const website = await createWebsite({ categoryId, name, url, icon, desc, sort });
    return json({ website }, 201);
  } catch (err) {
    console.error('[api/nav/sites]', err);
    return json({ error: '创建失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : '';
  if (!id) return json({ error: '缺少网站 ID' }, 400);
  const patch: {
    categoryId?: string;
    name?: string;
    url?: string;
    icon?: string | null;
    desc?: string | null;
    sort?: number;
  } = {};
  if (body.categoryId !== undefined) {
    const v = typeof body.categoryId === 'string' && body.categoryId.trim() ? body.categoryId.trim() : '';
    if (!v) return json({ error: '请选择分类' }, 400);
    patch.categoryId = v;
  }
  if (body.name !== undefined) {
    const v = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!v) return json({ error: '网站名不能为空' }, 400);
    patch.name = v;
  }
  if (body.url !== undefined) {
    const v = typeof body.url === 'string' ? body.url.trim().slice(0, MAX_URL) : '';
    if (!v) return json({ error: '网址不能为空' }, 400);
    patch.url = v;
  }
  if (body.icon !== undefined) patch.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  if (body.desc !== undefined) patch.desc = typeof body.desc === 'string' && body.desc.trim() ? body.desc.trim().slice(0, MAX_DESC) : null;
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const website = await updateWebsite(id, patch);
    if (!website) return json({ error: '网站不存在' }, 404);
    return json({ website });
  } catch (err) {
    console.error('[api/nav/sites]', err);
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
  if (!id) return json({ error: '缺少网站 ID' }, 400);
  try {
    await deleteWebsite(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/nav/sites]', err);
    return json({ error: '删除失败' }, 500);
  }
};
