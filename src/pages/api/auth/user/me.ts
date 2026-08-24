/**
 * GET /api/auth/user/me —— 当前 GitHub 登录用户信息（未登录返回 null）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getCurrentUserId } from '@/lib/auth';
import { getGithubUserById } from '@/lib/github-users';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const uid = getCurrentUserId(cookies);
  if (!uid) return json({ user: null });
  const user = await getGithubUserById(uid);
  if (!user) return json({ user: null });
  return json({
    user: {
      id: user.id,
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatarUrl,
    },
  });
};
