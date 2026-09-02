/**
 * GET /api/auth/user/github/callback —— 访客 OAuth 回调
 * 验 state → 换 token → 取 GitHub 用户 → upsert github_users → 建 user_session
 * → 跳回 next（默认 /moments）。
 */
import type { APIRoute } from 'astro';
import {
  exchangeGitHubCode,
  fetchGitHubUser,
  getOAuthStateNext,
  OAUTH_STATE_COOKIE,
  safeNextPath,
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

  // 登录后跳回来源页（state 中 next）。即使 state 已验签，仍要重新校验 next：
  // state 的 next 来自用户可控的 ?next=，且旧版本签发时未做严格校验。
  const safeNext = safeNextPath(getOAuthStateNext(state));

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
    return redirect(safeNext);
  } catch {
    return redirect('/?login=oauth-failed');
  }
};
