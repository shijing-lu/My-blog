/**
 * GET/POST/PATCH/DELETE /api/admin-auth/accounts —— 授权管理员账号管理（仅顶级管理员）
 *
 * - GET：列出全部授权管理员（含角色与逐项权限）；
 * - POST：{ login, role? } 按 GitHub 用户名直接建号（用于站主把自己的 GitHub 账号
 *   绑定为顶级管理员，不依赖 ADMIN_GITHUB_LOGIN 环境变量）；
 * - PATCH：{ id, role?, permissions? } 改角色 / 逐项授权；GitHub 顶级管理员不能操作自己
 *   （防止误降级/自删后权限体系失去管理者；站主会话不受限）；
 * - DELETE：?id= 移除授权账号。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import {
  createAdminAccount,
  deleteAdminAccount,
  fetchGitHubPublicProfile,
  getAdminAccountByGithubId,
  getAdminIdentity,
  isTopAdmin,
  listAdminAccounts,
  normalizePermissions,
  updateAdminAccount,
} from '@/lib/admin-auth';
import type { AdminRole } from '../../../../db/types';

export const prerender = false;

/** GET：账号列表 */
export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isTopAdmin(cookies))) return json({ error: '无权操作' }, 403);
  return json({ accounts: await listAdminAccounts() });
};

/** POST：按 GitHub 用户名直接建号（仅顶级管理员） */
export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind !== 'top' && !(identity.kind === 'github' && identity.account.role === 'top')) {
    return json({ error: '无权操作' }, 403);
  }
  let body: { login?: unknown; role?: unknown };
  try {
    body = (await request.json()) as { login?: unknown; role?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const login = typeof body.login === 'string' ? body.login.trim() : '';
  if (!login || !/^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/.test(login)) {
    return json({ error: '请输入有效的 GitHub 用户名' }, 400);
  }
  const role: AdminRole = body.role === 'top' ? 'top' : 'admin';
  const profile = await fetchGitHubPublicProfile(login);
  if (!profile) return json({ error: 'GitHub 用户不存在或获取失败' }, 404);
  const existing = await getAdminAccountByGithubId(profile.id);
  if (existing) {
    return json(
      {
        error: `该 GitHub 账号已在管理员列表中（@${existing.login}，当前角色：${existing.role === 'top' ? '顶级管理员' : '普通管理员'}）。如需调整角色，请在列表中使用「设为顶级管理员」。`,
        account: existing,
      },
      409,
    );
  }
  const account = await createAdminAccount({
    githubId: profile.id,
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    role,
    permissions: [],
  });
  return json({ account }, 201);
};

/** PATCH：改角色 / 逐项权限 */
export const PATCH: APIRoute = async ({ request, cookies }) => {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind !== 'top' && !(identity.kind === 'github' && identity.account.role === 'top')) {
    return json({ error: '无权操作' }, 403);
  }
  let body: { id?: unknown; role?: unknown; permissions?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; role?: unknown; permissions?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return json({ error: '缺少 id' }, 400);
  // GitHub 顶级管理员不能操作自己的账号（站主会话无对应账号，不受限）
  if (identity.kind === 'github' && identity.account.id === id) {
    return json({ error: '不能修改自己的账号' }, 403);
  }
  const role: AdminRole | undefined = body.role === 'top' || body.role === 'admin' ? body.role : undefined;
  const permissions = body.permissions !== undefined ? normalizePermissions(body.permissions) : undefined;
  const account = await updateAdminAccount(id, { role, permissions });
  if (!account) return json({ error: '账号不存在' }, 404);
  return json({ account });
};

/** DELETE：移除授权账号 */
export const DELETE: APIRoute = async ({ url, cookies }) => {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind !== 'top' && !(identity.kind === 'github' && identity.account.role === 'top')) {
    return json({ error: '无权操作' }, 403);
  }
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id) return json({ error: '缺少 id' }, 400);
  if (identity.kind === 'github' && identity.account.id === id) {
    return json({ error: '不能移除自己的账号' }, 403);
  }
  const ok = await deleteAdminAccount(id);
  if (!ok) return json({ error: '账号不存在' }, 404);
  return json({ ok: true });
};
