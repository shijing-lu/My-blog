/**
 * POST /api/likes/toggle —— 切换点赞（公开；幂等：赞↔取消）
 *
 * body: { targetType: 'article'|'moment', targetId, userType: 'anonymous'|'github', userIdent }
 * 返回: { liked, count }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { isLikeTargetType, isLikeUserType, toggleLike } from '@/lib/likes';

export const prerender = false;

/** 标识长度上限（防滥用超大 payload） */
const MAX_LEN = 200;

export const POST: APIRoute = async ({ request }) => {
  let body: { targetType?: unknown; targetId?: unknown; userType?: unknown; userIdent?: unknown };
  try {
    body = (await request.json()) as {
      targetType?: unknown;
      targetId?: unknown;
      userType?: unknown;
      userIdent?: unknown;
    };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  if (!isLikeTargetType(body.targetType)) return json({ error: '目标类型不合法' }, 400);
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId || targetId.length > MAX_LEN) return json({ error: '目标 ID 不合法' }, 400);
  if (!isLikeUserType(body.userType)) return json({ error: '用户类型不合法' }, 400);
  const userIdent = typeof body.userIdent === 'string' ? body.userIdent.trim() : '';
  if (!userIdent || userIdent.length > MAX_LEN) return json({ error: '缺少身份标识' }, 400);

  try {
    const result = await toggleLike(body.targetType, targetId, body.userType, userIdent);
    return json(result);
  } catch (err) {
    console.error('[api/likes/toggle]', err);
    return json({ error: '操作失败' }, 500);
  }
};
