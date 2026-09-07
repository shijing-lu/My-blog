/**
 * GET /api/admin-auth/me —— 当前访问者身份（「管理」入口页据此分支）
 *
 * 返回 { identity: 'top' | 'github' | 'visitor' | 'anonymous', account?, user? }：
 * - top：站主（顶级管理员），可进入授权管理页；
 * - github：GitHub 授权管理员（account 含 role/permissions/login/name/avatarUrl）；
 * - visitor：已 GitHub 登录但未获授权（user 含 GitHub 资料，可提交申请）；
 * - anonymous：未登录。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getAdminIdentity } from '@/lib/admin-auth';
import { getCurrentUserId } from '@/lib/auth';
import { getGithubUserById } from '@/lib/github-users';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const identity = await getAdminIdentity(cookies);
  if (identity.kind === 'top') return json({ identity: 'top' });
  if (identity.kind === 'github') {
    return json({
      identity: 'github',
      account: {
        role: identity.account.role,
        permissions: identity.account.permissions,
        login: identity.account.login,
        name: identity.account.name,
        avatarUrl: identity.account.avatarUrl,
      },
    });
  }
  if (identity.kind === 'visitor') {
    const user = await getGithubUserById(getCurrentUserId(cookies) ?? '');
    return json({
      identity: 'visitor',
      user: user ? { login: user.login, name: user.name || user.login, avatarUrl: user.avatarUrl } : null,
    });
  }
  return json({ identity: 'anonymous' });
};
