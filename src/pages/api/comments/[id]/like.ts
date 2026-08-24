/**
 * POST /api/comments/[id]/like —— 评论点赞 toggle（公开；幂等）
 *
 * body: { fingerprint? }（匿名指纹；GitHub 登录优先用 user_session）
 * 返回: { liked, likeCount }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getCurrentUserId } from '@/lib/auth';
import { getCommentById, toggleCommentLike } from '@/lib/comments';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const id = params.id ?? '';
  const comment = await getCommentById(id);
  if (!comment) return json({ error: '评论不存在' }, 404);

  const githubUserId = getCurrentUserId(cookies);
  let userType: 'anonymous' | 'github';
  let userIdent: string;
  if (githubUserId) {
    userType = 'github';
    userIdent = githubUserId;
  } else {
    let body: { fingerprint?: unknown };
    try {
      body = (await request.json()) as { fingerprint?: unknown };
    } catch {
      body = {};
    }
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.trim() : '';
    if (!fingerprint) return json({ error: '缺少身份标识' }, 400);
    userType = 'anonymous';
    userIdent = fingerprint;
  }

  try {
    const result = await toggleCommentLike(id, userType, userIdent);
    return json(result);
  } catch (err) {
    console.error('[api/comments/like]', err);
    return json({ error: '操作失败' }, 500);
  }
};
