/**
 * POST /api/login —— 口令登录
 *
 * 口令来源见 src/lib/owner-password.ts：站主在后台改过口令就只认新口令，
 * 没改过才回落到 .env / 桌面 config.json 的初始 ADMIN_PASSWORD。
 */
import type { APIRoute } from 'astro';
import { setSessionCookie } from '@/lib/auth';
import { verifyOwnerPassword } from '@/lib/owner-password';
import { badJson, json, readJson, unauthorized } from '@/lib/api';

export const prerender = false;

/** 登录处理：校验口令 → 写会话 Cookie */
export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await readJson<{ password?: unknown }>(request);
  if (!body) return badJson();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!(await verifyOwnerPassword(password))) {
    return unauthorized('密码错误');
  }
  setSessionCookie(cookies);
  return json({ ok: true });
};
