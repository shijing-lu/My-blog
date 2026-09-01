/**
 * GET/PATCH/DELETE /api/moments/[id] —— 单条动态（管理员写；GET 供编辑回显）
 *
 * - GET：单条动态（content + tags，供编辑弹窗回显）
 * - PATCH：更新内容 / 标签（管理员）
 * - DELETE：删除（管理员）
 */
import type { APIRoute } from 'astro';
import { MAX_CONTENT, deleteMoment, getMoment, updateMoment } from '@/lib/moments';
import { json } from '@/lib/api';

export const prerender = false;

/** GET：单条动态（公开，供编辑回显） */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const moment = await getMoment(id);
  if (!moment) return json({ error: '动态不存在' }, 404);
  return json({
    moment: {
      id: moment.id,
      content: moment.content,
      tags: moment.tags,
      createdAt: moment.createdAt.toISOString(),
    },
  });
};

/** PATCH：更新内容 / 标签（管理员） */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, MAX_CONTENT) : undefined;
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : undefined;
  if (content === undefined && tags === undefined) {
    return json({ error: '没有可更新字段' }, 400);
  }
  const moment = await updateMoment(id, { content, tags });
  if (!moment) return json({ error: '动态不存在' }, 404);
  return json({ moment: { id: moment.id, content: moment.content, tags: moment.tags } });
};

/** DELETE：删除（管理员） */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const moment = await deleteMoment(id);
  if (!moment) return json({ error: '动态不存在' }, 404);
  return json({ ok: true });
};
