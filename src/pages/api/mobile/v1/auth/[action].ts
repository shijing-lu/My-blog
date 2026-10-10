import type { APIRoute } from 'astro';
import { mobileAuth, mobileError, mobileJson, requireMobileOwner } from '@/lib/mobile-auth';
import { MobileAuthError } from '@/lib/mobile-auth-core';
import { clientKey, rateLimit } from '@/lib/rate-limit';

export const prerender = false;
export const GET: APIRoute = async ({ request, params }) => {
  try {
    if (params.action === 'info') return mobileJson(mobileAuth.info());
    if (params.action === 'me') return mobileJson(await requireMobileOwner(request));
    return mobileJson({ error: '接口不存在' }, 404);
  } catch (error) { return mobileError(error); }
};
export const POST: APIRoute = async ({ request, params }) => {
  try {
    if (!['login', 'refresh', 'revoke'].includes(params.action ?? '')) return mobileJson({ error: '接口不存在' }, 404);
    if (params.action === 'login') {
      const limit = rateLimit(`mobile-login:${clientKey(request)}`, 8, 60_000);
      if (!limit.ok) return mobileJson({ code: 'rate_limited', error: '尝试过于频繁，请稍后重试' }, 429, { 'retry-after': String(Math.ceil(limit.retryAfterSec)) });
    }
    const raw = await request.text();
    if (raw.length > 4096) throw new MobileAuthError(400, 'invalid_input', '请求内容过长');
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new MobileAuthError(400, 'invalid_input', '请求格式错误'); }
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new MobileAuthError(400, 'invalid_input', '请求格式错误');
    if (params.action === 'login') return mobileJson(await mobileAuth.login(body));
    if (params.action === 'refresh') return mobileJson(await mobileAuth.refresh(body));
    return mobileJson(await mobileAuth.revoke(typeof body.refreshToken === 'string' ? body.refreshToken : ''));
  } catch (error) { return mobileError(error); }
};
