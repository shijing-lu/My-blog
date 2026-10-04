/**
 * 全局中间件：后台路由鉴权（站主 + GitHub 授权管理员权限体系）
 *
 * - 站主（admin_session 口令/GitHub 白名单 或 top_admin_session 站主密码）：全部放行；
 * - GitHub 授权管理员（user_session → admin_accounts）：按组映射的逐项权限放行；
 * - 其余：页面 302 `/login?next=`；API 401 JSON。
 * - `/admin/auth`（授权管理页）不做通用保护，由页面自身做顶级管理员校验。
 *
 * 权限键与资源组的映射见 `requiredApiPermission` / `pagePermission`，
 * 键定义见 `src/lib/admin-auth.ts` PERMISSION_KEYS。
 */
import { defineMiddleware } from 'astro:middleware';
import type { AstroCookies } from 'astro';
import { hasAnyPermission, isOwnerSession, isTopAdmin } from '@/lib/admin-auth';
import { pagePermission, requiredApiPermission } from '@/lib/route-permissions';

/** 中间件 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const method = context.request.method;
  const pagePerm = pagePermission(pathname);
  const apiPerm = requiredApiPermission(pathname, method);
  if (!pagePerm && !apiPerm) return withCachePolicy(await next(), context.request);

  const cookies = context.cookies as AstroCookies;
  // 站主（口令 / GitHub 白名单 / 站主密码会话）全通过
  if (isOwnerSession(cookies)) return withCachePolicy(await next(), context.request);
  // 'top'：非站主时再判一次顶级管理员会话（授权管理类 API 的默认策略）
  if (apiPerm === 'top') {
    if (await isTopAdmin(cookies)) return withCachePolicy(await next(), context.request);
    return new Response(JSON.stringify({ error: '无权操作' }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  }
  // GitHub 授权管理员：按组权限判定
  if (await hasAnyPermission(cookies, (pagePerm ?? apiPerm)!)) {
    return withCachePolicy(await next(), context.request);
  }

  if (apiPerm) {
    // P1-10：文案与 API 端点保持一致（原为英文 'unauthorized'，前端统一按「未登录」处理）
    return new Response(JSON.stringify({ error: '未登录' }), {
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
  // P3-3：先按 content-type 过滤（非 HTML 直接原样返回，不做任何克隆），
  // 再按请求类型算出目标值；与现有值一致时连 Headers 都不复制，省掉整次重建。
  if (!type.includes('text/html')) return response;
  // 私密页面明确声明 no-store 时，不用预取缓存规则覆盖它。
  if (response.headers.get('cache-control')?.includes('no-store')) return response;
  const isPrefetch =
    request.headers.get('sec-purpose') === 'prefetch' || request.headers.get('purpose') === 'prefetch';
  const target = isPrefetch ? 'private, max-age=60' : 'no-store, no-cache, must-revalidate';
  if (response.headers.get('cache-control') === target) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', target);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
