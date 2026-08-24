/**
 * DELETE /api/comments/[id] —— 删除评论（作者本人 GitHub 登录 或 管理员）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getCurrentUserId, verifyRequest } from '@/lib/auth';
import { deleteComment, getCommentById } from '@/lib/comments';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const id = params.id ?? '';
  const comment = await getCommentById(id);
  if (!comment) return json({ error: '评论不存在' }, 404);

  // 管理员可删任意
  if (verifyRequest(cookies)) {
    await deleteComment(id);
    return json({ ok: true });
  }
  // GitHub 登录作者本人
  const uid = getCurrentUserId(cookies);
  if (uid && comment.githubUserId === uid && comment.authorType === 'github') {
    await deleteComment(id);
    return json({ ok: true });
  }
  return json({ error: '无权删除' }, 403);
};
