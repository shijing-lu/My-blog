/**
 * GET/POST /api/mindmaps —— 思维导图列表 / 创建
 *
 * GET:  ?articleId=xxx → { maps: [{id,title,articleId,updatedAt}] }（公开，不含 data）
 * POST: { title, articleId?, data? } → 201 { map }（管理员）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, readJson } from '@/lib/api';
import { createMindmap, emptyMindmapData, listMindmaps, stringifyMindmapData } from '@/lib/mindmaps';

export const prerender = false;

const MAX_TITLE = 100;

export const GET: APIRoute = async ({ url }) => {
  try {
    const articleId = url.searchParams.get('articleId')?.trim() || undefined;
    const maps = await listMindmaps(articleId);
    return json({
      maps: maps.map((m) => ({
        id: m.id,
        title: m.title,
        articleId: m.articleId,
        updatedAt: m.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[api/mindmaps]', err);
    return json({ error: '获取思维导图失败' }, 500);
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ title?: unknown; articleId?: unknown; data?: unknown }>(request);
  if (!body) return badJson();

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  if (!title) return badRequest('请填写导图标题');
  const articleId = typeof body.articleId === 'string' && body.articleId.trim() ? body.articleId.trim().slice(0, 200) : null;

  let data: string;
  if (typeof body.data === 'string' && body.data.trim()) {
    // 校验为合法 JSON
    try {
      JSON.parse(body.data);
    } catch {
      return badRequest('导图数据不合法');
    }
    data = body.data;
  } else {
    data = stringifyMindmapData(emptyMindmapData(title));
  }

  try {
    const map = await createMindmap({ title, articleId, data });
    return json(
      { map: { id: map.id, title: map.title, articleId: map.articleId, updatedAt: map.updatedAt.toISOString() } },
      201,
    );
  } catch (err) {
    console.error('[api/mindmaps]', err);
    return json({ error: '创建失败' }, 500);
  }
};
