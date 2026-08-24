/**
 * POST /api/likes/toggle —— 切换点赞（公开；幂等：赞↔取消）
 *
 * body: { targetType: 'article'|'moment', targetId, fingerprint }
 * 返回: { liked, count }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { isLikeTargetType, toggleLike } from '@/lib/likes';

export const prerender = false;

/** 指纹/ID 长度上限（防止滥用超大 payload） */
const MAX_LEN = 200;

export const POST: APIRoute = async ({ request }) => {
  let body: { targetType?: unknown; targetId?: unknown; fingerprint?: unknown };
  try {
    body = (await request.json()) as { targetType?: unknown; targetId?: unknown; fingerprint?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const targetType = body.targetType;
  if (!isLikeTargetType(targetType)) return json({ error: '目标类型不合法' }, 400);
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.trim() : '';
  if (!targetId || targetId.length > MAX_LEN) return json({ error: '目标 ID 不合法' }, 400);
  if (!fingerprint || fingerprint.length > MAX_LEN) return json({ error: '缺少指纹' }, 400);

  try {
    const result = await toggleLike(targetType, targetId, fingerprint);
    return json(result);
  } catch (err) {
    console.error('[api/likes/toggle]', err);
    return json({ error: '操作失败' }, 500);
  }
};
