/**
 * GET/POST/PATCH /api/admin-auth/applications —— 管理员权限申请
 *
 * - POST：访客提交申请（需 GitHub 登录 user_session；同一账号重复提交覆盖重置为待审）；
 * - GET：申请列表（仅顶级管理员；?status=pending|approved|rejected|all，默认 pending）；
 * - PATCH：审批（仅顶级管理员）{ id, action: 'approve'|'reject', permissions? }，
 *   同意即按 permissions（默认空集，可后续逐项调）创建授权账号。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, forbidden, json, missing, notFound, readJson, readJsonLoose, unauthorized } from '@/lib/api';
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
  if (!uid) return unauthorized('请先登录 GitHub 再申请');
  const user = await getGithubUserById(uid);
  if (!user) return unauthorized('登录状态已失效，请重新登录 GitHub');
  // 已是授权管理员则无需申请
  const existing = await getAdminAccountByGithubId(user.githubId);
  if (existing) return badRequest('该账号已是授权管理员');
  /* 允许空 body（note 可选），故宽容解析 */
  const body = await readJsonLoose<{ note?: unknown }>(request);
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
  if (!(await isTopAdmin(cookies))) return forbidden();
  const raw = url.searchParams.get('status') ?? 'pending';
  const status = raw === 'all' || raw === 'approved' || raw === 'rejected' ? raw : 'pending';
  return json({ applications: await listApplications(status) });
};

/** PATCH：审批 */
export const PATCH: APIRoute = async ({ request, cookies }) => {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind !== 'top' && !(identity.kind === 'github' && identity.account.role === 'top')) {
    return forbidden();
  }
  const body = await readJson<{ id?: unknown; action?: unknown; permissions?: unknown }>(request);
  if (!body) return badJson();
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return missing('id');
  if (body.action !== 'approve' && body.action !== 'reject') {
    return badRequest('action 须为 approve 或 reject');
  }
  const permissions = body.permissions !== undefined ? normalizePermissions(body.permissions) : undefined;
  const result = await setApplicationStatus(id, body.action === 'approve' ? 'approved' : 'rejected', permissions);
  if (!result.application) return notFound('申请不存在');
  return json({
    application: { id: result.application.id, status: result.application.status },
    createdAccount: result.createdAccount,
  });
};
