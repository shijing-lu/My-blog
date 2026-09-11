/**
 * GET/PATCH/DELETE /api/moments/[id] —— 单条动态（管理员写；GET 供编辑回显）
 *
 * - GET：单条动态（content + tags + visibility，供编辑弹窗回显）。
 *   私密动态仅管理员可读，普通访客一律 404（不暴露存在性）。
 * - PATCH：更新内容 / 标签 / 可见性（管理员）
 * - DELETE：删除（管理员）
 */
import type { APIRoute } from 'astro';
import { MAX_CONTENT, deleteMoment, getMoment, isValidMedia, normalizeVisibility, updateMoment } from '@/lib/moments';
import { canManage } from '@/lib/admin-auth';
import { badJson, badRequest, json, missing, notFound, readJson } from '@/lib/api';
import type { MomentMedia } from '../../../../db/types';

export const prerender = false;

/** 单条动态媒体数量上限（与 POST /api/moments 一致） */
const MAX_MEDIA = 9;

/** GET：单条动态（私密动态仅管理员可见，其余 404） */
export const GET: APIRoute = async ({ params, cookies }) => {
  const id = params.id;
  if (!id) return missing('id');
  const moment = await getMoment(id);
  if (!moment) return notFound('动态不存在');
  if (moment.visibility === 'private' && !(await canManage(cookies, 'moments'))) {
    return notFound('动态不存在');
  }
  return json({
    moment: {
      id: moment.id,
      content: moment.content,
      media: moment.media,
      tags: moment.tags,
      visibility: moment.visibility,
      createdAt: moment.createdAt.toISOString(),
    },
  });
};

/** PATCH：更新内容 / 媒体 / 标签 / 可见性（管理员） */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, MAX_CONTENT) : undefined;
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : undefined;
  // 可见性仅显式传入时更新（未传不改；非法值回落 public，与发布一致）
  const visibility = body.visibility === undefined ? undefined : normalizeVisibility(body.visibility);
  // 媒体仅显式传入时更新（未传不改）；校验规则与 POST /api/moments 一致
  let media: MomentMedia[] | undefined;
  if (body.media !== undefined) {
    if (!Array.isArray(body.media)) return badRequest('media 格式错误');
    if (body.media.length > MAX_MEDIA) return json({ error: `最多 ${MAX_MEDIA} 个媒体` }, 400);
    const validMedia = (body.media as unknown[]).filter(isValidMedia);
    if (validMedia.length !== body.media.length) return badRequest('媒体格式错误');
    media = validMedia;
  }
  if (content === undefined && media === undefined && tags === undefined && visibility === undefined) {
    return badRequest('没有可更新字段');
  }
  const moment = await updateMoment(id, { content, media, tags, visibility });
  if (!moment) return notFound('动态不存在');
  return json({
    moment: { id: moment.id, content: moment.content, media: moment.media, tags: moment.tags, visibility: moment.visibility },
  });
};

/** DELETE：删除（管理员） */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  const moment = await deleteMoment(id);
  if (!moment) return notFound('动态不存在');
  return json({ ok: true });
};
