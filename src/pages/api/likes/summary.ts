/**
 * GET /api/likes/summary —— 点赞计数 + 当前指纹是否已赞（公开）
 *
 * query: targetType, targetId, fingerprint?
 * 返回: { count, liked }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { countLikes, hasLiked, isLikeTargetType } from '@/lib/likes';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const targetType = url.searchParams.get('targetType');
  if (!isLikeTargetType(targetType)) return json({ error: '目标类型不合法' }, 400);
  const targetId = url.searchParams.get('targetId') ?? '';
  if (!targetId) return json({ error: '缺少目标 ID' }, 400);
  const fingerprint = url.searchParams.get('fingerprint') ?? '';

  const [count, liked] = await Promise.all([
    countLikes(targetType, targetId),
    fingerprint ? hasLiked(targetType, targetId, fingerprint) : Promise.resolve(false),
  ]);
  return json({ count, liked });
};
