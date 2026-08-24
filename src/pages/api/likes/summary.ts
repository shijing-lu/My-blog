/**
 * GET /api/likes/summary —— 点赞计数（公开）
 *
 * query: targetType, targetId, userType?, userIdent?
 * 返回:
 *   - 普通访客：{ total, liked }
 *   - 管理员（admin_session）：{ total, anonymous, github, liked }（拆分视图）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { countLikes, countLikesByType, hasLiked, isLikeTargetType, isLikeUserType } from '@/lib/likes';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies }) => {
  const targetType = url.searchParams.get('targetType');
  if (!isLikeTargetType(targetType)) return json({ error: '目标类型不合法' }, 400);
  const targetId = url.searchParams.get('targetId') ?? '';
  if (!targetId) return json({ error: '缺少目标 ID' }, 400);
  const userType = url.searchParams.get('userType') ?? '';
  const userIdent = url.searchParams.get('userIdent') ?? '';
  const isAuthed = verifyRequest(cookies);

  if (isAuthed) {
    // 管理员：返回拆分计数
    const [split, liked] = await Promise.all([
      countLikesByType(targetType, targetId),
      userType && isLikeUserType(userType) && userIdent
        ? hasLiked(targetType, targetId, userType, userIdent)
        : Promise.resolve(false),
    ]);
    return json({ total: split.total, anonymous: split.anonymous, github: split.github, liked });
  }

  // 普通访客：仅返回总和
  const [total, liked] = await Promise.all([
    countLikes(targetType, targetId),
    userType && isLikeUserType(userType) && userIdent
      ? hasLiked(targetType, targetId, userType, userIdent)
      : Promise.resolve(false),
  ]);
  return json({ total, liked });
};
