/**
 * DELETE /api/comments/[id] —— 删除评论（作者本人 GitHub 登录 或 管理员）
 */
import type { APIRoute } from 'astro';
import { forbidden, json, notFound } from '@/lib/api';
import { getCurrentUserId } from '@/lib/auth';
import { canManage } from '@/lib/admin-auth';
import { deleteComment, getCommentById } from '@/lib/comments';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const id = params.id ?? '';
  const comment = await getCommentById(id);
  if (!comment) return notFound('评论不存在');

  // 持有 comments 权限的管理员（含站主）可删任意
  if (await canManage(cookies, 'comments')) {
    await deleteComment(id);
    return json({ ok: true });
  }
  // GitHub 登录作者本人
  const uid = getCurrentUserId(cookies);
  if (uid && comment.githubUserId === uid && comment.authorType === 'github') {
    await deleteComment(id);
    return json({ ok: true });
  }
  return forbidden('无权删除');
};
