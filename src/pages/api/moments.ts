/**
 * GET/POST /api/moments —— 动态（动态圈）
 *
 * - GET：分页列表（公开）；支持 ?tag= / ?q= / ?date=YYYY-MM-DD 筛选
 * - POST：发布（管理员，中间件保护）；支持 tags: string[]
 */
import type { APIRoute } from 'astro';
import { addMoment, isValidMedia, listMoments, MAX_TAGS } from '@/lib/moments';
import { json, jsonCached } from '@/lib/api';

export const prerender = false;

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_CONTENT = 2000;
const MAX_MEDIA = 9;

/** GET：分页列表（公开，可筛选） */
export const GET: APIRoute = async ({ url }) => {
  const rawLimit = Number(url.searchParams.get('limit') ?? String(PAGE_SIZE));
  const rawOffset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.floor(rawLimit)), MAX_PAGE_SIZE)
    : PAGE_SIZE;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;

  const tag = (url.searchParams.get('tag') ?? '').trim().slice(0, 20);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const date = (url.searchParams.get('date') ?? '').trim();
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;

  const items = await listMoments(limit, offset, {
    tag: tag || undefined,
    q: q || undefined,
    date: dateValid,
  });
  return jsonCached({
    moments: items.map((m) => ({
      id: m.id,
      content: m.content,
      media: m.media,
      tags: m.tags,
      createdAt: m.createdAt.toISOString(),
      // 预留：评论/点赞（后续实现时补充，不影响现有消费者）
      likeCount: 0,
      commentCount: 0,
    })),
  });
};

/** POST：发布（管理员） */
export const POST: APIRoute = async ({ request }) => {
  let body: { content?: unknown; media?: unknown; tags?: unknown };
  try {
    body = (await request.json()) as { content?: unknown; media?: unknown; tags?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, MAX_CONTENT) : '';
  const media = Array.isArray(body.media) ? body.media : [];
  if (content === '' && media.length === 0) {
    return json({ error: '动态内容不能为空（文字或至少一个媒体）' }, 400);
  }
  if (media.length > MAX_MEDIA) {
    return json({ error: `最多 ${MAX_MEDIA} 个媒体` }, 400);
  }
  const validMedia = media.filter(isValidMedia);
  if (validMedia.length !== media.length) {
    return json({ error: '媒体格式不合法' }, 400);
  }
  // 标签：字符串数组，最多 MAX_TAGS 个（单个由 serializeTags 限长）
  const rawTags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  if (rawTags.length > MAX_TAGS) {
    return json({ error: `最多 ${MAX_TAGS} 个标签` }, 400);
  }
  const moment = await addMoment(content, validMedia, rawTags);
  return json({
    moment: {
      id: moment.id,
      content: moment.content,
      media: moment.media,
      tags: moment.tags,
      createdAt: moment.createdAt.toISOString(),
    },
  });
};
