/**
 * POST /api/login —— 口令登录
 */
import type { APIRoute } from 'astro';
import { checkPassword, setSessionCookie } from '@/lib/auth';
import { json } from '@/lib/api';

export const prerender = false;

/** 登录处理：校验口令 → 写会话 Cookie */
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!checkPassword(password)) {
    return json({ error: '密码错误' }, 401);
  }
  setSessionCookie(cookies);
  return json({ ok: true });
};
