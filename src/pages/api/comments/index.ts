/**
 * GET/POST /api/comments —— 评论列表 / 发布（公开）
 *
 * GET:  ?targetType=article|moment&targetId=&page=1&pageSize=6&sort=hot|latest&fingerprint=
 *       → { comments: CommentItem[], total, hasMore }
 * POST: { targetType, targetId, parentId?, content, authorName? }
 *       GitHub 登录（user_session）自动以 GitHub 身份；匿名需 authorName。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getCurrentUserId } from '@/lib/auth';
import { addComment, getCommentById, isCommentTargetType, listComments } from '@/lib/comments';

export const prerender = false;

const MAX_PAGE_SIZE = 50;
const MAX_CONTENT = 2000;
const MAX_NAME = 50;

/** GET：评论列表（公开） */
export const GET: APIRoute = async ({ url, cookies }) => {
  const targetType = url.searchParams.get('targetType');
  if (!isCommentTargetType(targetType)) return json({ error: '目标类型不合法' }, 400);
  const targetId = url.searchParams.get('targetId') ?? '';
  if (!targetId) return json({ error: '缺少目标 ID' }, 400);

  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const rawSize = Number(url.searchParams.get('pageSize') ?? '6');
  const pageSize = Number.isFinite(rawSize) ? Math.min(Math.max(1, Math.floor(rawSize)), MAX_PAGE_SIZE) : 6;
  const sort = url.searchParams.get('sort') === 'latest' ? 'latest' : 'hot';

  // 查看者身份：GitHub 登录 → uid；否则匿名指纹（query 传入）
  const githubUserId = getCurrentUserId(cookies);
  const fingerprint = url.searchParams.get('fingerprint') ?? '';
  const viewer = githubUserId
    ? { githubUserId, fingerprint: null }
    : fingerprint
      ? { githubUserId: null, fingerprint }
      : null;

  try {
    const result = await listComments(targetType, targetId, { page, pageSize, sort }, viewer);
    return json(result);
  } catch (err) {
    console.error('[api/comments]', err);
    return json({ error: '获取评论失败' }, 500);
  }
};

/** POST：发布评论（公开；GitHub 登录或匿名） */
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: {
    targetType?: unknown;
    targetId?: unknown;
    parentId?: unknown;
    content?: unknown;
    authorName?: unknown;
  };
  try {
    body = (await request.json()) as {
      targetType?: unknown;
      targetId?: unknown;
      parentId?: unknown;
      content?: unknown;
      authorName?: unknown;
    };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  if (!isCommentTargetType(body.targetType)) return json({ error: '目标类型不合法' }, 400);
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId || targetId.length > 200) return json({ error: '目标 ID 不合法' }, 400);

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return json({ error: '评论内容不能为空' }, 400);
  if (content.length > MAX_CONTENT) return json({ error: `评论不能超过 ${MAX_CONTENT} 字` }, 400);

  let parentId: string | null = null;
  if (typeof body.parentId === 'string' && body.parentId.trim()) {
    parentId = body.parentId.trim();
    const parent = await getCommentById(parentId);
    if (!parent) return json({ error: '回复的评论不存在' }, 400);
    // 任意层级可回复（展示时统一归并到顶级评论下平铺）
    if (parent.targetType !== body.targetType || parent.targetId !== targetId) {
      return json({ error: '回复的评论不属于该内容' }, 400);
    }
  }

  const githubUserId = getCurrentUserId(cookies);
  let authorType: 'anonymous' | 'github';
  let authorName: string;
  if (githubUserId) {
    authorType = 'github';
    authorName = '';
  } else {
    authorType = 'anonymous';
    authorName = typeof body.authorName === 'string' ? body.authorName.trim().slice(0, MAX_NAME) : '';
    if (!authorName) return json({ error: '匿名评论请填写昵称' }, 400);
  }

  try {
    const comment = await addComment({
      targetType: body.targetType,
      targetId,
      parentId,
      content,
      authorType,
      authorName,
      githubUserId,
    });
    return json(
      {
        comment: {
          id: comment.id,
          parentId: comment.parentId,
          content: comment.content,
          createdAt: comment.createdAt,
        },
      },
      201,
    );
  } catch (err) {
    console.error('[api/comments]', err);
    return json({ error: '发布失败' }, 500);
  }
};
