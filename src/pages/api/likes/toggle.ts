/**
 * POST /api/likes/toggle —— 切换点赞（公开；幂等：赞↔取消）
 *
 * body: { targetType: 'article'|'moment'|'comment', targetId, fingerprint? }
 * 身份：GitHub 登录（user_session）优先 → github + 本站 uid；否则匿名指纹。
 * 返回: { liked, count }
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, json, readJson } from '@/lib/api';
import { getCurrentUserId } from '@/lib/auth';
import { isLikeTargetType, toggleLike } from '@/lib/likes';

export const prerender = false;

const MAX_LEN = 200;

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await readJson<{ targetType?: unknown; targetId?: unknown; userType?: unknown; userIdent?: unknown; fingerprint?: unknown }>(request);
  if (!body) return badJson();

  if (!isLikeTargetType(body.targetType)) return badRequest('目标类型不合法');
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId || targetId.length > MAX_LEN) return badRequest('目标 ID 不合法');

  // 身份：GitHub 登录（user_session）优先
  const githubUserId = getCurrentUserId(cookies);
  let userType: 'anonymous' | 'github';
  let userIdent: string;
  if (githubUserId) {
    userType = 'github';
    userIdent = githubUserId;
  } else {
    // 兼容旧调用（userType/userIdent）与匿名指纹（fingerprint）
    const fingerprint =
      typeof body.fingerprint === 'string'
        ? body.fingerprint.trim()
        : typeof body.userIdent === 'string'
          ? body.userIdent.trim()
          : '';
    if (!fingerprint || fingerprint.length > MAX_LEN) return badRequest('缺少身份标识');
    userType = 'anonymous';
    userIdent = fingerprint;
  }

  try {
    const result = await toggleLike(body.targetType, targetId, userType, userIdent);
    return json(result);
  } catch (err) {
    console.error('[api/likes/toggle]', err);
    return json({ error: '操作失败' }, 500);
  }
};
