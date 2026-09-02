/**
 * GET /api/auth/user/github —— 发起访客 GitHub OAuth（评论/点赞身份）
 * 携带 ?next= 记录登录后跳转路径（默认 /moments）。
 */
import type { APIRoute } from 'astro';
import { createOAuthState, gitHubUserAuthUrl, OAUTH_STATE_COOKIE, safeNextPath } from '@/lib/auth';
import { isProd } from '@/lib/env';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  // 仅允许站内相对路径，防开放重定向（含反斜杠绕过、绝对 URL、控制字符注入）
  const next = safeNextPath(url.searchParams.get('next'));
  const state = createOAuthState(next);
  cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return redirect(gitHubUserAuthUrl(state));
};
