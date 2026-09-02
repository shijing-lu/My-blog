/**
 * 鉴权核心：会话 Cookie（HMAC 签名）、口令比对、GitHub OAuth
 *
 * <!-- 区域划分 -->
 * - 常量与密钥：SESSION_COOKIE / OAUTH_STATE_COOKIE / 时长 / HMAC 密钥
 * - 会话：signSession / verifySessionToken / set/clearSessionCookie / verifyRequest
 * - 口令：checkPassword（timing-safe）
 * - OAuth：createOAuthState / verifyOAuthState / GitHub 授权·换 token·取 user
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { serverEnv, isProd } from '@/lib/env';

/** 会话 Cookie 名（管理员） */
export const SESSION_COOKIE = 'admin_session';
/** 会话 Cookie 名（GitHub 登录用户，评论/点赞身份） */
export const USER_SESSION_COOKIE = 'user_session';
/** OAuth state Cookie 名 */
export const OAUTH_STATE_COOKIE = 'oauth_state';
/** 会话时长：7 天 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** OAuth state 有效期：10 分钟 */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * HMAC 密钥来源。
 *
 * 安全约束（不要回退）：AUTH_SECRET 缺失时**不再**由 ADMIN_PASSWORD 派生。
 * 派生密钥意味着「能否伪造任意管理员会话」只取决于一个可能被暴力枚举的口令，
 * 且口令一改历史会话全部失效、泄漏面更大。生产环境必须显式配置 AUTH_SECRET，
 * 缺失直接抛错（fail-fast），避免带着可被伪造的会话签名的进程静默启动。
 */
function secret(): Buffer {
  const raw = serverEnv('AUTH_SECRET');
  if (!raw) {
    throw new Error(
      'AUTH_SECRET 未配置：拒绝以 ADMIN_PASSWORD 派生会话签名密钥。请在环境变量中设置足够长的随机 AUTH_SECRET。',
    );
  }
  return createHash('sha256').update(raw).digest();
}

/** base64url 编码 */
function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** 对载荷计算 HMAC 签名 */
function hmac(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('hex');
}

/** 签名一个带过期时间的令牌（payload.hmac） */
function signPayload(payload: Record<string, unknown>): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

/** 校验签名令牌（HMAC 恒定时间比较 + 过期检查） */
function verifySignedPayload(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = hmac(payload);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

/** 签发会话令牌 */
export function signSession(): string {
  return signPayload({ exp: Date.now() + SESSION_TTL_MS });
}

/** 校验会话令牌 */
export function verifySessionToken(token: string | undefined | null): boolean {
  return verifySignedPayload(token);
}

/** 设置会话 Cookie（HttpOnly；生产 Secure） */
export function setSessionCookie(cookies: AstroCookies, ttlMs = SESSION_TTL_MS): void {
  cookies.set(SESSION_COOKIE, signSession(), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: Math.floor(ttlMs / 1000),
    path: '/',
  });
}

/** 清除会话 Cookie */
export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** 校验请求 Cookie 中的会话 */
export function verifyRequest(cookies: AstroCookies): boolean {
  return verifySessionToken(cookies.get(SESSION_COOKIE)?.value);
}

/* ---------------- GitHub 登录用户会话（评论/点赞身份，与管理员隔离） ---------------- */

/** 签发用户会话令牌（载荷含本站 github_user id） */
export function signUserSession(githubUserId: string): string {
  return signPayload({ uid: githubUserId, exp: Date.now() + SESSION_TTL_MS });
}

/** 校验用户会话令牌，返回本站 github_user id；无效返回 null */
export function verifyUserSessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if (hmac(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof data.uid !== 'string' || typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}

/** 从请求 Cookie 获取当前 GitHub 用户 id（未登录返回 null） */
export function getCurrentUserId(cookies: AstroCookies): string | null {
  return verifyUserSessionToken(cookies.get(USER_SESSION_COOKIE)?.value);
}

/** 设置用户会话 Cookie（HttpOnly；生产 Secure） */
export function setUserSessionCookie(cookies: AstroCookies, githubUserId: string): void {
  cookies.set(USER_SESSION_COOKIE, signUserSession(githubUserId), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: '/',
  });
}

/** 清除用户会话 Cookie */
export function clearUserSessionCookie(cookies: AstroCookies): void {
  cookies.delete(USER_SESSION_COOKIE, { path: '/' });
}

/** 口令比对（timing-safe，双方均做哈希以等长比较） */
export function checkPassword(input: string): boolean {
  const expected = serverEnv('ADMIN_PASSWORD');
  if (!expected) return false;
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** OAuth 登录后默认回跳路径 */
export const DEFAULT_OAUTH_NEXT = '/moments';

/**
 * 规范化「登录后回跳路径」，防开放重定向。
 *
 * 必须同时挡住以下几类绕过（仅检查 `startsWith('/') && !startsWith('//')` 是不够的）：
 * - `//evil.com`      —— 协议相对 URL，浏览器会跳到外站
 * - `/\evil.com`、`\evil.com` —— 浏览器把反斜杠规范化为正斜杠，`\e` 会变成 `//e` 从而绕过 `//` 检查
 * - `http://evil.com`、`javascript:...`、`data:...` —— 绝对 URL 与其它 scheme
 * - 控制字符 / 空白 —— 防 Location 响应头注入与解析歧义
 *
 * 通过校验的路径保证是「以单个 `/` 开头的同源相对路径」。
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = DEFAULT_OAUTH_NEXT): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  const value = raw.trim().slice(0, 500);
  // 必须是站内相对路径，且不是协议相对 URL
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // 反斜杠会被浏览器规范化为正斜杠，是 `//` 检查的绕过手段
  if (value.includes('\\')) return fallback;
  // 控制字符与空白：防响应头注入
  if (/[\u0000-\u001F\u007F\s]/.test(value)) return fallback;
  try {
    // 以不可能冲突的主机作 base 解析：任何绝对 URL 都会产生不同的 origin
    const parsed = new URL(value, 'http://internal.invalid');
    if (parsed.origin !== 'http://internal.invalid') return fallback;
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return path.startsWith('/') ? path : fallback;
  } catch {
    return fallback;
  }
}

/** 签发 OAuth state（防 CSRF；可选携带登录后跳转路径 next） */
export function createOAuthState(next?: string): string {
  const payload: Record<string, unknown> = {
    nonce: randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  };
  if (next) payload.next = next;
  return signPayload(payload);
}

/** 校验 OAuth state */
export function verifyOAuthState(state: string | undefined | null): boolean {
  return verifySignedPayload(state);
}

/** 解析 OAuth state 携带的 next（校验签名+过期；无效返回 null） */
export function getOAuthStateNext(state: string | undefined | null): string | null {
  if (!state) return null;
  const [payload, sig] = state.split('.');
  if (!payload || !sig || hmac(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      next?: unknown;
      exp?: unknown;
    };
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return typeof data.next === 'string' ? data.next : null;
  } catch {
    return null;
  }
}

/** 生成 GitHub 授权地址（管理员登录） */
export function gitHubAuthUrl(state: string): string {
  const clientId = serverEnv('GITHUB_CLIENT_ID');
  const site = serverEnv('PUBLIC_SITE_URL') || 'http://localhost:4321';
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${site}/api/auth/github/callback`,
    scope: 'read:user',
    state,
  });
  return `https://github.com/login/oauth/authorize?${qs.toString()}`;
}

/** 生成 GitHub 授权地址（访客登录，用于评论/点赞；独立回调，不查白名单） */
export function gitHubUserAuthUrl(state: string): string {
  const clientId = serverEnv('GITHUB_CLIENT_ID');
  const site = serverEnv('PUBLIC_SITE_URL') || 'http://localhost:4321';
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${site}/api/auth/user/github/callback`,
    scope: 'read:user',
    state,
  });
  return `https://github.com/login/oauth/authorize?${qs.toString()}`;
}

/** 用授权码换取 access_token */
export async function exchangeGitHubCode(code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: serverEnv('GITHUB_CLIENT_ID'),
      client_secret: serverEnv('GITHUB_CLIENT_SECRET'),
      code,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error ?? 'GitHub 授权码换取失败');
  return data.access_token;
}

/** 用 token 取 GitHub 用户（含 id/头像/昵称） */
export async function fetchGitHubUser(
  token: string,
): Promise<{ id: number; login: string; name: string | null; avatar_url: string | null }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'my-blog' },
  });
  if (!res.ok) throw new Error('GitHub 用户信息获取失败');
  const data = (await res.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  return {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url ?? null,
  };
}

/** 是否允许该 GitHub 登录（与 ADMIN_GITHUB_LOGIN 不区分大小写比对） */
export function isAllowedGitHubLogin(login: string): boolean {
  const allowed = serverEnv('ADMIN_GITHUB_LOGIN');
  return Boolean(allowed) && login.toLowerCase() === allowed.toLowerCase();
}

/** GitHub OAuth 是否已配置（前端据此显示登录按钮） */
export function isGitHubConfigured(): boolean {
  return Boolean(serverEnv('GITHUB_CLIENT_ID') && serverEnv('GITHUB_CLIENT_SECRET') && serverEnv('ADMIN_GITHUB_LOGIN'));
}
