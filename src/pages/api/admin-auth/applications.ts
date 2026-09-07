/**
 * GET/POST/PATCH /api/admin-auth/applications —— 管理员权限申请
 *
 * - POST：访客提交申请（需 GitHub 登录 user_session；同一账号重复提交覆盖重置为待审）；
 * - GET：申请列表（仅顶级管理员；?status=pending|approved|rejected|all，默认 pending）；
 * - PATCH：审批（仅顶级管理员）{ id, action: 'approve'|'reject', permissions? }，
 *   同意即按 permissions（默认空集，可后续逐项调）创建授权账号。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getCurrentUserId } from '@/lib/auth';
import { getGithubUserById } from '@/lib/github-users';
import {
  getAdminAccountByGithubId,
  getAdminIdentity,
  isTopAdmin,
  listApplications,
  normalizePermissions,
  setApplicationStatus,
  upsertApplication,
} from '@/lib/admin-auth';

export const prerender = false;

/** POST：访客提交申请（GitHub 登录后） */
export const POST: APIRoute = async ({ request, cookies }) => {
  const uid = getCurrentUserId(cookies);
  if (!uid) return json({ error: '请先登录 GitHub 再申请' }, 401);
  const user = await getGithubUserById(uid);
  if (!user) return json({ error: '登录状态已失效，请重新登录 GitHub' }, 401);
  // 已是授权管理员则无需申请
  const existing = await getAdminAccountByGithubId(user.githubId);
  if (existing) return json({ error: '该账号已是授权管理员' }, 400);
  let body: { note?: unknown } = {};
  try {
    body = (await request.json()) as { note?: unknown };
  } catch {
    /* 允许空 body */
  }
  const note = typeof body.note === 'string' ? body.note : '';
  const app = await upsertApplication({
    githubId: user.githubId,
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatarUrl,
    note,
  });
  return json({ application: { id: app.id, status: app.status } });
};

/** GET：申请列表（顶级管理员） */
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!(await isTopAdmin(cookies))) return json({ error: '无权操作' }, 403);
  const raw = url.searchParams.get('status') ?? 'pending';
  const status = raw === 'all' || raw === 'approved' || raw === 'rejected' ? raw : 'pending';
  return json({ applications: await listApplications(status) });
};

/** PATCH：审批 */
export const PATCH: APIRoute = async ({ request, cookies }) => {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind !== 'top' && !(identity.kind === 'github' && identity.account.role === 'top')) {
    return json({ error: '无权操作' }, 403);
  }
  let body: { id?: unknown; action?: unknown; permissions?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; action?: unknown; permissions?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return json({ error: '缺少 id' }, 400);
  if (body.action !== 'approve' && body.action !== 'reject') {
    return json({ error: 'action 须为 approve 或 reject' }, 400);
  }
  const permissions = body.permissions !== undefined ? normalizePermissions(body.permissions) : undefined;
  const result = await setApplicationStatus(id, body.action === 'approve' ? 'approved' : 'rejected', permissions);
  if (!result.application) return json({ error: '申请不存在' }, 404);
  return json({
    application: { id: result.application.id, status: result.application.status },
    createdAccount: result.createdAccount,
  });
};
