/**
 * 全局中间件：后台路由鉴权
 *
 * - 页面：`/admin*` 未登录 → 302 `/login?next=<原路径>`
 * - API：`/api/save-draft`、`/api/articles/*` 未登录 → 401 JSON
 * - 公开 API：`/api/login`、`/api/logout`、`/api/auth/*`
 */
import { defineMiddleware } from 'astro:middleware';
import { verifyRequest } from '@/lib/auth';

/** 受保护 API 前缀（其余 /api 公开） */
const PROTECTED_API_PREFIXES = ['/api/save-draft', '/api/articles'];

/** 是否为受保护页面路径 */
function isProtectedPage(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/edit' ||
    pathname.startsWith('/edit/')
  );
}

/** 是否为受保护 API 路径 */
function isProtectedApi(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 中间件 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const protectedPage = isProtectedPage(pathname);
  // 图片上传仅 POST 受保护；GET 输出图片公开
  const protectedApi =
    pathname.startsWith('/api/') &&
    (isProtectedApi(pathname) || (pathname === '/api/images' && context.request.method === 'POST'));
  if (!protectedPage && !protectedApi) return next();

  if (verifyRequest(context.cookies)) return next();

  if (protectedApi) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return context.redirect(`/login?next=${encodeURIComponent(pathname)}`);
});
