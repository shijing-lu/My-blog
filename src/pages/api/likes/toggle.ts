/**
 * POST /api/likes/toggle —— 切换点赞（公开；幂等：赞↔取消）
 *
 * body: { targetType: 'article'|'moment'|'comment', targetId, fingerprint? }
 * 身份：GitHub 登录（user_session）优先 → github + 本站 uid；否则匿名指纹。
 * 返回: { liked, count }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getCurrentUserId } from '@/lib/auth';
import { isLikeTargetType, toggleLike } from '@/lib/likes';

export const prerender = false;

const MAX_LEN = 200;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { targetType?: unknown; targetId?: unknown; userType?: unknown; userIdent?: unknown; fingerprint?: unknown };
  try {
    body = (await request.json()) as {
      targetType?: unknown;
      targetId?: unknown;
      userType?: unknown;
      userIdent?: unknown;
      fingerprint?: unknown;
    };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  if (!isLikeTargetType(body.targetType)) return json({ error: '目标类型不合法' }, 400);
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId || targetId.length > MAX_LEN) return json({ error: '目标 ID 不合法' }, 400);

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
    if (!fingerprint || fingerprint.length > MAX_LEN) return json({ error: '缺少身份标识' }, 400);
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
