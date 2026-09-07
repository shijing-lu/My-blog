/**
 * POST /api/logout —— 退出登录（清除全部会话 Cookie）
 *
 * 统一清空三类会话：站主密码会话（top_admin_session）、旧管理员会话
 * （admin_session）、GitHub 用户会话（user_session）。清除未持有的
 * Cookie 无副作用，因此不区分身份、一次全清，避免「登了 A 清 B」的错位。
 */
import type { APIRoute } from 'astro';
import { clearSessionCookie, clearUserSessionCookie } from '@/lib/auth';
import { clearTopSessionCookie } from '@/lib/admin-auth';
import { json } from '@/lib/api';

export const prerender = false;

/** 退出处理 */
export const POST: APIRoute = async ({ cookies }) => {
  clearSessionCookie(cookies);
  clearTopSessionCookie(cookies);
  clearUserSessionCookie(cookies);
  return json({ ok: true });
};
