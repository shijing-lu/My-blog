/**
 * GET /api/auth/user/github/callback —— 访客 OAuth 回调
 * 验 state → 换 token → 取 GitHub 用户 → upsert github_users → 建 user_session
 * 不检查管理员白名单；登录后跳回站点首页（评论区可显示身份）。
 */
import type { APIRoute } from 'astro';
import {
  exchangeGitHubCode,
  fetchGitHubUser,
  OAUTH_STATE_COOKIE,
  setUserSessionCookie,
  verifyOAuthState,
} from '@/lib/auth';
import { upsertGithubUser } from '@/lib/github-users';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stored = cookies.get(OAUTH_STATE_COOKIE)?.value;
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });

  if (!code || !state || !stored || state !== stored || !verifyOAuthState(state)) {
    return redirect('/?login=oauth-invalid');
  }

  try {
    const token = await exchangeGitHubCode(code);
    const gh = await fetchGitHubUser(token);
    const user = await upsertGithubUser({
      githubId: gh.id,
      login: gh.login,
      name: gh.name,
      avatarUrl: gh.avatar_url,
    });
    setUserSessionCookie(cookies, user.id);
    return redirect('/');
  } catch {
    return redirect('/?login=oauth-failed');
  }
};
