import type { APIRoute } from 'astro';
import { isOwnerSession } from '@/lib/admin-auth';
import { serverEnv } from '@/lib/env';
export const prerender = false;
export const GET: APIRoute = ({ cookies }) => new Response(JSON.stringify({ ok: isOwnerSession(cookies) && serverEnv('DESKTOP_MODE') === '1' }), {
  status: isOwnerSession(cookies) && serverEnv('DESKTOP_MODE') === '1' ? 200 : 403,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});
