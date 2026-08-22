/**
 * GET /api/auth/github/callback —— OAuth 回调：验 state → 换 token → 取 user → 建会话
 */
import type { APIRoute } from 'astro';
import {
  exchangeGitHubCode,
  fetchGitHubUser,
  isAllowedGitHubLogin,
  OAUTH_STATE_COOKIE,
  setSessionCookie,
  verifyOAuthState,
} from '@/lib/auth';

export const prerender = false;

/** 回调处理 */
export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stored = cookies.get(OAUTH_STATE_COOKIE)?.value;
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });

  if (!code || !state || !stored || state !== stored || !verifyOAuthState(state)) {
    return redirect('/login?error=oauth-invalid');
  }

  try {
    const token = await exchangeGitHubCode(code);
    const user = await fetchGitHubUser(token);
    if (!isAllowedGitHubLogin(user.login)) {
      return redirect('/login?error=oauth-forbidden');
    }
    setSessionCookie(cookies);
    return redirect('/admin');
  } catch {
    return redirect('/login?error=oauth-failed');
  }
};
