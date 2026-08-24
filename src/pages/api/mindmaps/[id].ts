/**
 * GET/PUT/DELETE /api/mindmaps/[id] —— 导图详情 / 保存 / 删除
 *
 * GET:   → { map: { id, title, articleId, data(对象), updatedAt } }（公开）
 * PUT:   { title?, articleId?, data? } → { map }（管理员；data 为 JSON 字符串）
 * DELETE: → { ok }（管理员）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { deleteMindmap, getMindmap, parseMindmapData, updateMindmap } from '@/lib/mindmaps';

export const prerender = false;

const MAX_TITLE = 100;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  try {
    const map = await getMindmap(id);
    if (!map) return json({ error: '思维导图不存在' }, 404);
    return json({
      map: {
        id: map.id,
        title: map.title,
        articleId: map.articleId,
        data: parseMindmapData(map.data),
        updatedAt: map.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[api/mindmaps]', err);
    return json({ error: '获取思维导图失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ params, request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  const id = params.id ?? '';
  let body: { title?: unknown; articleId?: unknown; data?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; articleId?: unknown; data?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const patch: { title?: string; articleId?: string | null; data?: string } = {};
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
    if (!title) return json({ error: '导图标题不能为空' }, 400);
    patch.title = title;
  }
  if (body.articleId !== undefined) {
    patch.articleId = typeof body.articleId === 'string' && body.articleId.trim() ? body.articleId.trim().slice(0, 200) : null;
  }
  if (body.data !== undefined) {
    if (typeof body.data !== 'string' || !body.data.trim()) return json({ error: '导图数据不合法' }, 400);
    try {
      JSON.parse(body.data);
    } catch {
      return json({ error: '导图数据不合法' }, 400);
    }
    patch.data = body.data;
  }

  try {
    const map = await updateMindmap(id, patch);
    if (!map) return json({ error: '思维导图不存在' }, 404);
    return json({
      map: { id: map.id, title: map.title, articleId: map.articleId, updatedAt: map.updatedAt.toISOString() },
    });
  } catch (err) {
    console.error('[api/mindmaps]', err);
    return json({ error: '保存失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  const id = params.id ?? '';
  try {
    await deleteMindmap(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/mindmaps]', err);
    return json({ error: '删除失败' }, 500);
  }
};
