/**
 * POST /api/auth/user/logout —— 退出 GitHub 登录（清 user_session）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { clearUserSessionCookie } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  clearUserSessionCookie(cookies);
  return json({ ok: true });
};
