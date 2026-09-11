/**
 * GET/POST /api/moments —— 动态（动态圈）
 *
 * - GET：分页列表；支持 ?tag= / ?q= / ?date=YYYY-MM-DD 筛选。
 *   普通访客仅见 public 动态（响应可 CDN 缓存）；管理员（含 cookie 会话）额外见
 *   private 动态，此时响应**不走缓存**——同一 URL 两类身份内容不同，若共享
 *   CDN 缓存会互相污染（访客看到私密内容 / 管理员看到旧数据）。
 * - POST：发布（管理员，中间件保护）；支持 tags: string[] 与 visibility 可见性
 */
import type { APIRoute } from 'astro';
import { addMoment, isValidMedia, listMoments, MAX_TAGS, normalizeVisibility, toMomentView } from '@/lib/moments';
import { canManage } from '@/lib/admin-auth';
import { badJson, badRequest, json, jsonCached, readJson } from '@/lib/api';

export const prerender = false;

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_CONTENT = 2000;
const MAX_MEDIA = 9;

/** GET：分页列表（访客见公开动态；管理员见全部） */
export const GET: APIRoute = async ({ url, cookies }) => {
  // 私密动态可见性：站主或持有 moments 权限的 GitHub 授权管理员
  const isAuthed = await canManage(cookies, 'moments');
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
    includePrivate: isAuthed,
  });
  const views = await Promise.all(items.map((m) => toMomentView(m)));
  const payload = {
    moments: views.map((m) => ({
      id: m.id,
      content: m.content,
      contentHtml: m.contentHtml,
      media: m.media,
      tags: m.tags,
      visibility: m.visibility,
      createdAt: m.createdAt.toISOString(),
      // 预留：评论/点赞（后续实现时补充，不影响现有消费者）
      likeCount: 0,
      commentCount: 0,
    })),
  };
  // 管理员响应含私密动态，不进 CDN 缓存；访客响应内容稳定，保持短缓存
  return isAuthed ? json(payload) : jsonCached(payload);
};

/** POST：发布（管理员） */
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ content?: unknown; media?: unknown; tags?: unknown; visibility?: unknown }>(request);
  if (!body) return badJson();
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, MAX_CONTENT) : '';
  const media = Array.isArray(body.media) ? body.media : [];
  if (content === '' && media.length === 0) {
    return badRequest('动态内容不能为空（文字或至少一个媒体）');
  }
  if (media.length > MAX_MEDIA) {
    return json({ error: `最多 ${MAX_MEDIA} 个媒体` }, 400);
  }
  const validMedia = media.filter(isValidMedia);
  if (validMedia.length !== media.length) {
    return badRequest('媒体格式不合法');
  }
  // 标签：字符串数组，最多 MAX_TAGS 个（单个由 serializeTags 限长）
  const rawTags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  if (rawTags.length > MAX_TAGS) {
    return json({ error: `最多 ${MAX_TAGS} 个标签` }, 400);
  }
  // 可见性：public（默认）/ private，非法值回落 public
  const visibility = normalizeVisibility(body.visibility);
  const moment = await addMoment(content, validMedia, rawTags, visibility);
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
