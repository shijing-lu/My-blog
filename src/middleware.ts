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
import { hasAnyPermission, isOwnerSession, isTopAdmin, type PermissionKey } from '@/lib/admin-auth';

/**
 * `/api/admin-auth/*` 中显式公开的端点（其余一律按「仅顶级管理员」处理）
 *
 * 背景（P2-27）：这段路由原先完全不在中间件视野内，靠每个文件各自记得自校验。
 * 一旦新增端点忘了加 `isTopAdmin` 就直接裸奔。改为**默认拒绝 + 显式放行**：
 * 新增端点默认受保护，要公开必须在此登记并写明理由。
 * - login：登录本身，必然公开（否则无法登录）；
 * - me：自身身份探针，只回读调用者自己的会话信息；
 * - applications POST：访客提交自己的申请，端点内部已校验 GitHub 登录态。
 */
const PUBLIC_ADMIN_AUTH: Array<{ path: string; method?: string }> = [
  { path: '/api/admin-auth/login', method: 'POST' },
  { path: '/api/admin-auth/me' },
  { path: '/api/admin-auth/applications', method: 'POST' },
];

/** 该 admin-auth 端点是否在公开名单内 */
function isPublicAdminAuth(pathname: string, method: string): boolean {
  return PUBLIC_ADMIN_AUTH.some((e) => e.path === pathname && (e.method === undefined || e.method === method));
}

/**
 * 受保护 API → 所需权限键（返回 null = 非保护 API，直接放行；返回 'top' = 仅顶级管理员）。
 * 行为与原 verifyRequest 版本完全等价（站主全通过），仅增加 GitHub 管理员分支。
 */
function requiredApiPermission(pathname: string, method: string): PermissionKey[] | 'top' | null {
  // 动态：读公开、写需 moments 权限
  if (pathname === '/api/moments' || pathname.startsWith('/api/moments/')) {
    return ['POST', 'PATCH', 'DELETE'].includes(method) ? ['moments'] : null;
  }
  // 文章/草稿：管理员写
  if (pathname === '/api/save-draft' || pathname === '/api/articles' || pathname.startsWith('/api/articles/')) {
    return ['articles'];
  }
  // 图片上传：编辑器/动态/影集共用，任一内容权限即可
  if (pathname === '/api/images' && method === 'POST') return ['articles', 'moments', 'photos'];
  // 影集：读公开、写需 photos 权限
  if (pathname === '/api/photos' || pathname.startsWith('/api/photos/')) {
    return ['POST', 'PATCH', 'DELETE'].includes(method) ? ['photos'] : null;
  }
  // 待办/日记为私密内容：全部方法需 calendar 权限
  if (pathname === '/api/todos' || pathname.startsWith('/api/todos/') || pathname === '/api/diary' || pathname.startsWith('/api/diary/')) {
    return ['calendar'];
  }
  // 重要日期：读公开、写需 calendar 权限
  if (pathname === '/api/calendar-events' || pathname.startsWith('/api/calendar-events/')) {
    return ['POST', 'PATCH', 'DELETE'].includes(method) ? ['calendar'] : null;
  }
  // 文档系统：分类/文档/文章/预览的写方法需 docs 权限；树/单篇/搜索 GET 公开
  if (pathname.startsWith('/api/doc/')) {
    if ((pathname === '/api/doc' || pathname === '/api/doc/search') && method === 'GET') return null;
    if (pathname.startsWith('/api/doc/articles/') && method === 'GET') return null;
    return method !== 'GET' ? ['docs'] : null;
  }
  // 导航：分类/子分类/网站的写方法需 nav 权限（GET 聚合数据公开）
  if (pathname.startsWith('/api/nav/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return ['nav'];
  }
  // 站点设置类（个人中心之外的站点级配置）：写需 settings 权限
  if (
    (pathname === '/api/quote-settings' ||
      pathname === '/api/background' ||
      pathname === '/api/landing' ||
      pathname === '/api/site-name') &&
    method === 'PUT'
  ) {
    return ['settings'];
  }
  if (
    (pathname === '/api/sync-databases' ||
      pathname === '/api/migrate-photos-tags' ||
      pathname === '/api/migrate-article-crypto' ||
      pathname === '/api/migrate-article-categories') &&
    method === 'POST'
  ) {
    return ['settings'];
  }
  // 个人中心：写需 profile 权限
  if (pathname === '/api/profile' && method === 'PUT') return ['profile'];
  // 网盘对接（含 /api/netdisk-settings 与 /api/netdisk-test 与 /api/netdisk/*）：
  // 列目录/取直链也含网盘结构信息，统一按 netdisk 权限收紧
  if (pathname === '/api/netdisk-settings' || pathname === '/api/netdisk-test' || pathname.startsWith('/api/netdisk/')) {
    return ['netdisk'];
  }
  // 授权管理类：默认仅顶级管理员（见 PUBLIC_ADMIN_AUTH 注释）
  if (pathname.startsWith('/api/admin-auth/')) {
    return isPublicAdminAuth(pathname, method) ? null : 'top';
  }
  return null;
}

/**
 * 受保护页面 → 所需权限键（返回 null = 非保护页面，或页面自校验）。
 * `/admin/auth` 返回 null：授权管理页自身做顶级管理员校验（非顶级渲染「无权」）。
 */
function pagePermission(pathname: string): PermissionKey[] | null {
  if (pathname === '/admin/auth') return null;
  if (pathname === '/admin/settings') return ['settings'];
  if (pathname === '/admin/nav') return ['nav'];
  // 网盘管理页（须在 /admin/* 兜底之前，否则会被要求 articles 权限）
  if (pathname === '/admin/netdisk' || pathname.startsWith('/admin/netdisk/')) return ['netdisk'];
  if (pathname === '/admin/mindmaps' || pathname.startsWith('/admin/mindmaps/')) return ['articles'];
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return ['articles'];
  if (pathname === '/edit' || pathname.startsWith('/edit/')) return ['articles'];
  if (pathname === '/gallery/upload') return ['photos'];
  if (pathname === '/calendar/diary' || pathname.startsWith('/calendar/diary/')) return ['calendar'];
  return null;
}

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
      headers: { 'content-type': 'application/json' },
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
