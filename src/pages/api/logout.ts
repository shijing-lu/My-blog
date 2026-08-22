/**
 * POST /api/logout —— 退出登录（清除会话 Cookie）
 */
import type { APIRoute } from 'astro';
import { clearSessionCookie } from '@/lib/auth';
import { json } from '@/lib/api';

export const prerender = false;

/** 退出处理 */
export const POST: APIRoute = async ({ cookies }) => {
  clearSessionCookie(cookies);
  return json({ ok: true });
};
