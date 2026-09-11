/**
 * POST /api/admin-auth/login —— 站主登录（顶级管理员）
 *
 * body: { password } → checkTopPassword（timing-safe）→ 签发 top_admin_session Cookie。
 * 与现有 /api/login（ADMIN_PASSWORD 口令 → admin_session）并行：两者都代表站主身份，
 * getAdminIdentity 对二者均判为顶级管理员。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, json, readJson, unauthorized } from '@/lib/api';
import { checkTopPassword, setTopSessionCookie } from '@/lib/admin-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await readJson<{ password?: unknown }>(request);
  if (!body) return badJson();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return badRequest('请输入站主密码');
  if (!checkTopPassword(password)) {
    return unauthorized('站主密码错误');
  }
  setTopSessionCookie(cookies);
  return json({ ok: true });
};
