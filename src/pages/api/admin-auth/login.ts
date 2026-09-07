/**
 * POST /api/admin-auth/login —— 站主登录（顶级管理员）
 *
 * body: { password } → checkTopPassword（timing-safe）→ 签发 top_admin_session Cookie。
 * 与现有 /api/login（ADMIN_PASSWORD 口令 → admin_session）并行：两者都代表站主身份，
 * getAdminIdentity 对二者均判为顶级管理员。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { checkTopPassword, setTopSessionCookie } from '@/lib/admin-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return json({ error: '请输入站主密码' }, 400);
  if (!checkTopPassword(password)) {
    return json({ error: '站主密码错误' }, 401);
  }
  setTopSessionCookie(cookies);
  return json({ ok: true });
};
