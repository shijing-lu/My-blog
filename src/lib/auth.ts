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

/** 会话 Cookie 名 */
export const SESSION_COOKIE = 'admin_session';
/** OAuth state Cookie 名 */
export const OAUTH_STATE_COOKIE = 'oauth_state';
/** 会话时长：7 天 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** OAuth state 有效期：10 分钟 */
const STATE_TTL_MS = 10 * 60 * 1000;

/** HMAC 密钥（AUTH_SECRET 优先，缺省由 ADMIN_PASSWORD 派生） */
function secret(): Buffer {
  const raw = serverEnv('AUTH_SECRET') || createHash('sha256').update(serverEnv('ADMIN_PASSWORD')).digest('hex');
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

/** 口令比对（timing-safe，双方均做哈希以等长比较） */
export function checkPassword(input: string): boolean {
  const expected = serverEnv('ADMIN_PASSWORD');
  if (!expected) return false;
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** 签发 OAuth state（防 CSRF） */
export function createOAuthState(): string {
  return signPayload({ nonce: randomBytes(16).toString('hex'), exp: Date.now() + STATE_TTL_MS });
}

/** 校验 OAuth state */
export function verifyOAuthState(state: string | undefined | null): boolean {
  return verifySignedPayload(state);
}

/** 生成 GitHub 授权地址 */
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

/** 用 token 取 GitHub 用户 */
export async function fetchGitHubUser(token: string): Promise<{ login: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'my-blog' },
  });
  if (!res.ok) throw new Error('GitHub 用户信息获取失败');
  return (await res.json()) as { login: string };
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
