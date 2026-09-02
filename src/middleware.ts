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
  // 学习模式：任务/打断全方法需登录；番茄记录仅 POST 需登录；统计 GET 公开
  const isStudyApi = pathname.startsWith('/api/study/');
  const protectedStudyApi =
    isStudyApi &&
    !(pathname === '/api/study/stats') &&
    !(pathname === '/api/study/sessions' && context.request.method === 'GET');
  // 文档系统：分类/文档/文章/预览的写方法需登录；树/单篇/搜索 GET 公开
  const isDocApi = pathname.startsWith('/api/doc/');
  const protectedDocApi =
    isDocApi &&
    !(pathname === '/api/doc' && context.request.method === 'GET') &&
    !(pathname === '/api/doc/search' && context.request.method === 'GET') &&
    !pathname.startsWith('/api/doc/articles/') && // 单篇 GET 公开
    context.request.method !== 'GET';
  const protectedApi =
    pathname.startsWith('/api/') &&
    (isProtectedApi(pathname) ||
      isPrivateCalendarApi ||
      (pathname === '/api/images' && context.request.method === 'POST') ||
      (isPhotosApi && ['POST', 'PATCH', 'DELETE'].includes(context.request.method)) ||
      (pathname === '/api/quote-settings' && context.request.method === 'PUT') ||
      (pathname === '/api/background' && context.request.method === 'PUT') ||
      (pathname === '/api/landing' && context.request.method === 'PUT') ||
      (pathname === '/api/sync-databases' && context.request.method === 'POST') ||
      (pathname === '/api/migrate-photos-tags' && context.request.method === 'POST') ||
      (isEventsApi && ['POST', 'PATCH', 'DELETE'].includes(context.request.method)) ||
      (isMomentsApi && ['POST', 'PATCH', 'DELETE'].includes(context.request.method)) ||
      // 导航：分类/子分类/网站的写方法需登录（GET 聚合数据公开）
      (pathname.startsWith('/api/nav/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(context.request.method)) ||
      (pathname === '/api/profile' && context.request.method === 'PUT') ||
      protectedStudyApi ||
      protectedDocApi);
  if (!protectedPage && !protectedApi) return withCachePolicy(await next(), context.request);

  if (verifyRequest(context.cookies)) return withCachePolicy(await next(), context.request);

  if (protectedApi) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return context.redirect(`/login?next=${encodeURIComponent(pathname)}`);
});

/**
 * HTML 响应缓存策略（区分预取与普通导航）：
 * - 预取请求（Sec-Purpose/Purpose: prefetch，由 hover 预取触发）：
 *   允许浏览器短缓存（60s），点击导航时 fetch 命中缓存 → 消除页面切换卡顿；
 * - 普通导航：no-store，防止浏览器缓存旧页面 HTML 后引用已被新构建
 *   替换/删除的 JS chunk（会导致 React 岛 / CodeMirror 编辑器脚本 404 而不渲染）。
 * 静态资源（/_astro/*.js 带 hash）仍由平台长缓存，不受影响。
 */
function withCachePolicy(response: Response, request: Request): Response {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  const isPrefetch =
    request.headers.get('sec-purpose') === 'prefetch' || request.headers.get('purpose') === 'prefetch';
  if (isPrefetch) {
    headers.set('Cache-Control', 'private, max-age=60');
  } else {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
