/**
 * GET /api/auth/user/github —— 发起访客 GitHub OAuth（评论/点赞身份）
 * 与管理员 OAuth 独立：不查白名单，任何人可登录评论。
 */
import type { APIRoute } from 'astro';
import { createOAuthState, gitHubUserAuthUrl, OAUTH_STATE_COOKIE } from '@/lib/auth';
import { isProd } from '@/lib/env';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, redirect }) => {
  const state = createOAuthState();
  cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return redirect(gitHubUserAuthUrl(state));
};
