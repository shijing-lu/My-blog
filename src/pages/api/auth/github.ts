/**
 * GET /api/auth/github —— 发起 GitHub OAuth 授权（签发 state → 302 GitHub）
 */
import type { APIRoute } from 'astro';
import { createOAuthState, gitHubAuthUrl, isGitHubConfigured, OAUTH_STATE_COOKIE } from '@/lib/auth';
import { isProd } from '@/lib/env';

export const prerender = false;

/** 跳转 GitHub 授权 */
export const GET: APIRoute = async ({ cookies, redirect }) => {
  if (!isGitHubConfigured()) {
    return redirect('/login?error=oauth-not-configured');
  }
  const state = createOAuthState();
  cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return redirect(gitHubAuthUrl(state));
};
