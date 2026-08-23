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
    pathname.startsWith('/edit/') ||
    pathname === '/gallery/upload' ||
    pathname.startsWith('/calendar/diary')
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
  // 相册照片的写方法（上传/改/删）受保护；GET 列表公开
  const isPhotosApi =
    pathname === '/api/photos' || pathname.startsWith('/api/photos/');
  // 待办/日记为私密内容：全部方法需登录
  const isPrivateCalendarApi =
    pathname === '/api/todos' ||
    pathname.startsWith('/api/todos/') ||
    pathname === '/api/diary' ||
    pathname.startsWith('/api/diary/');
  // 重要日期：读公开、写需登录
  const isEventsApi =
    pathname === '/api/calendar-events' || pathname.startsWith('/api/calendar-events/');
  // 动态：读公开、写需登录；个人中心：写需登录
  const isMomentsApi = pathname === '/api/moments' || pathname.startsWith('/api/moments/');
  const protectedApi =
    pathname.startsWith('/api/') &&
    (isProtectedApi(pathname) ||
      isPrivateCalendarApi ||
      (pathname === '/api/images' && context.request.method === 'POST') ||
      (isPhotosApi && ['POST', 'PATCH', 'DELETE'].includes(context.request.method)) ||
      (pathname === '/api/quote-settings' && context.request.method === 'PUT') ||
      (pathname === '/api/background' && context.request.method === 'PUT') ||
      (isEventsApi && ['POST', 'PATCH', 'DELETE'].includes(context.request.method)) ||
      (isMomentsApi && ['POST', 'DELETE'].includes(context.request.method)) ||
      (pathname === '/api/profile' && context.request.method === 'PUT'));
  if (!protectedPage && !protectedApi) return withNoCache(await next());

  if (verifyRequest(context.cookies)) return withNoCache(await next());

  if (protectedApi) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return context.redirect(`/login?next=${encodeURIComponent(pathname)}`);
});

/**
 * HTML 响应禁用缓存：防止浏览器/代理缓存旧页面 HTML 后引用已被新构建
 * 替换/删除的 JS chunk（会导致 React 岛 / CodeMirror 编辑器脚本 404 而不渲染）。
 * 静态资源（/_astro/*.js 带 hash）仍由平台长缓存，不受影响。
 */
function withNoCache(response: Response): Response {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
