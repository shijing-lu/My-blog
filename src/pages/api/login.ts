/**
 * POST /api/login —— 口令登录
 */
import type { APIRoute } from 'astro';
import { checkPassword, setSessionCookie } from '@/lib/auth';
import { badJson, json, readJson, unauthorized } from '@/lib/api';

export const prerender = false;

/** 登录处理：校验口令 → 写会话 Cookie */
export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await readJson<{ password?: unknown }>(request);
  if (!body) return badJson();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!checkPassword(password)) {
    return unauthorized('密码错误');
  }
  setSessionCookie(cookies);
  return json({ ok: true });
};
