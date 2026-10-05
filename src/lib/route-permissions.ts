import type { PermissionKey } from './admin-auth';

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
export function requiredApiPermission(pathname: string, method: string): PermissionKey[] | 'top' | null {
  // Astro 可接受尾斜杠；权限匹配必须与实际路由保持一致。
  pathname = pathname.replace(/\/+$/, '') || '/';
  // handler 再按身份 kind='top' 收紧至站主本人，授权 top 管理员也不共享私人日程。
  if (pathname === '/api/cadence' || pathname.startsWith('/api/cadence/')) return 'top';
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  // 这些端点自身只有通用 manager 守卫，需要在此补齐逐项权限。
  if (pathname === '/api/article-categories') return ['articles'];
  if (pathname === '/api/mindmaps' || pathname.startsWith('/api/mindmaps/')) {
    return isWrite ? ['articles'] : null;
  }
  if (
    pathname === '/api/site-css' || pathname === '/api/md-css' || pathname.startsWith('/api/md-css/') ||
    pathname === '/api/fonts-settings' || pathname === '/api/image-bed-settings' || pathname === '/api/image-bed-test' ||
    pathname === '/api/ai/config' || pathname === '/api/ai/test'
  ) return ['settings'];
  if ((pathname === '/api/fonts' || pathname.startsWith('/api/fonts/')) && isWrite) return ['settings'];
  // 保留公开聊天入口；记忆端点原本已在内部限制为站主。
  if (pathname === '/api/ai/memory' || pathname === '/api/ai/summarize') return 'top';
  if (pathname === '/api/quick-notes' || pathname.startsWith('/api/quick-notes/')) return 'top';
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
  if (pathname === '/api/diary' || pathname.startsWith('/api/diary/')) return 'top';
  if (pathname === '/api/todos' || pathname.startsWith('/api/todos/')) return ['calendar'];
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
      pathname === '/api/ui-style' ||
      pathname === '/api/background' ||
      pathname === '/api/landing' ||
      pathname === '/api/site-name' ||
      pathname === '/api/editor-shortcuts') &&
    method === 'PUT'
  ) {
    return ['settings'];
  }
  if (
    (pathname === '/api/sync-databases' ||
      pathname === '/api/migrate-photos-tags' ||
      pathname === '/api/migrate-article-crypto' ||
      pathname === '/api/migrate-article-categories' ||
      pathname === '/api/migrate-ai-memory') &&
    method === 'POST'
  ) {
    return ['settings'];
  }
  // 个人中心：写需 profile 权限
  if (pathname === '/api/profile' && method === 'PUT') return ['profile'];
  // 桌面端同步（/api/desktop/sync、/api/desktop/object/*）：
  // ⚠️ 白名单式登记——不在此处返回权限数组即等于"不保护"（端点裸奔）
  // 对象缓存路由例外：返回的是 R2 上本就公开的对象（暴露面与原 publicUrl 一致），
  // 放行以便桌面端未登录时也能显示图片
  if (pathname.startsWith('/api/desktop/object/')) return null;
  if (pathname.startsWith('/api/desktop/')) return ['settings'];
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
export function pagePermission(pathname: string): PermissionKey[] | null {
  pathname = pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/admin/auth') return null;
  if (pathname === '/admin/settings/netdisk') return ['netdisk'];
  if (pathname === '/admin/settings' || pathname.startsWith('/admin/settings/')) return ['settings'];
  if (pathname === '/admin/nav') return ['nav'];
  // 网盘管理页（须在 /admin/* 兜底之前，否则会被要求 articles 权限）
  if (pathname === '/admin/netdisk' || pathname.startsWith('/admin/netdisk/')) return ['netdisk'];
  if (pathname === '/admin/mindmaps' || pathname.startsWith('/admin/mindmaps/')) return ['articles'];
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return ['articles'];
  if (pathname === '/edit' || pathname.startsWith('/edit/')) return ['articles'];
  if (pathname === '/gallery/upload' || pathname === '/gallery/manage-cards') return ['photos'];
  // 日志与旧日历编辑页在各自 SSR 入口使用 isTopAdmin 鉴权。
  if (pathname === '/diary' || pathname === '/calendar/diary' || pathname.startsWith('/calendar/diary/')) return null;
  return null;
}

