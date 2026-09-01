/**
 * 站点背景配置（统一背景 / 按页面独立背景）
 *
 * - 存储：settings 表 `site_background` 键（JSON），管理员在 /admin/settings 配置；
 * - 读取：BaseLayout 服务端按 pathname 解析并渲染背景层，全站一致、零 JS；
 * - 模式：
 *   - unified：全站同一张背景（enabled + imageUrl + opacity + blur）
 *   - pages：按页面键独立配置（pages[pageKey] = { imageUrl, opacity, blur }；未配置的页面无背景）
 * - 未配置时默认关闭。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';

/** 页面键（白名单） */
export type PageKey =
  | 'home'
  | 'study'
  | 'doc'
  | 'nav'
  | 'gallery'
  | 'calendar'
  | 'moments'
  | 'blog'
  | 'login'
  | 'other';

/** 页面键 → 中文名（设置页展示用） */
export const PAGE_KEY_LABELS: Record<PageKey, string> = {
  home: '首页',
  study: '学习',
  doc: '文档',
  nav: '导航',
  gallery: '影集',
  calendar: '日历',
  moments: '动态',
  blog: '文章详情',
  login: '登录页',
  other: '其他页面',
};

export const PAGE_KEYS = Object.keys(PAGE_KEY_LABELS) as PageKey[];

/** 单页背景 */
export interface PageBackground {
  imageUrl: string;
  opacity: number;
  blur: number;
}

/** 背景配置 */
export interface SiteBackground {
  /** unified=全站统一 / pages=按页面独立 */
  mode: 'unified' | 'pages';
  /** 统一模式：是否开启背景层 */
  enabled: boolean;
  /** 统一模式：背景图 URL（http(s) 或站内路径） */
  imageUrl: string;
  /** 统一模式：背景透明度 0-100（%） */
  opacity: number;
  /** 统一模式：背景模糊度 0-24（px） */
  blur: number;
  /** 按页模式：页面键 → 该页背景（未配置 = 该页无背景） */
  pages: Partial<Record<PageKey, PageBackground>>;
  /** 星光闪烁粒子（暗色模式背景装饰，设置可开关；默认开启） */
  stardust: boolean;
}

/** 配置键 */
const KEY = 'site_background';

/** 默认（关闭，统一模式；星光默认开启——保持既有暗色效果） */
export const DEFAULT_BACKGROUND: SiteBackground = {
  mode: 'unified',
  enabled: false,
  imageUrl: '',
  opacity: 50,
  blur: 0,
  pages: {},
  stardust: true,
};

/** pathname → 页面键（动态路由归组） */
export function pageKeyFromPathname(pathname: string): PageKey {
  const p = pathname.split('?')[0] ?? '';
  if (p === '/') return 'home';
  if (p === '/study' || p.startsWith('/study/')) return 'study';
  if (p === '/doc' || p.startsWith('/doc/')) return 'doc';
  if (p === '/nav') return 'nav';
  if (p === '/gallery' || p.startsWith('/gallery/')) return 'gallery';
  if (p === '/calendar' || p.startsWith('/calendar/')) return 'calendar';
  if (p === '/moments') return 'moments';
  if (p.startsWith('/blog/')) return 'blog';
  if (p === '/login') return 'login';
  return 'other';
}

/** 数值收敛到合法区间 */
function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

/** 规范化单页背景（无 URL 视为未配置） */
function normalizePageBg(input: Partial<PageBackground> | undefined): PageBackground | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const url =
    typeof input.imageUrl === 'string' && input.imageUrl.trim() !== ''
      ? input.imageUrl.trim().slice(0, 2048)
      : '';
  if (!url) return undefined;
  return {
    imageUrl: url,
    opacity: clamp(
      typeof input.opacity === 'number' ? input.opacity : NaN,
      0,
      100,
      DEFAULT_BACKGROUND.opacity,
    ),
    blur: clamp(
      typeof input.blur === 'number' ? input.blur : NaN,
      0,
      24,
      DEFAULT_BACKGROUND.blur,
    ),
  };
}

/** 规范化校验（兼容旧配置：无 mode 视为 unified） */
function normalize(input: Partial<SiteBackground>): SiteBackground {
  const mode: 'unified' | 'pages' = input.mode === 'pages' ? 'pages' : 'unified';
  const pages: SiteBackground['pages'] = {};
  if (mode === 'pages' && input.pages && typeof input.pages === 'object') {
    for (const k of PAGE_KEYS) {
      const pb = normalizePageBg((input.pages as Record<string, unknown>)[k] as Partial<PageBackground> | undefined);
      if (pb) pages[k] = pb;
    }
  }
  return {
    mode,
    enabled: input.enabled === true,
    imageUrl:
      typeof input.imageUrl === 'string' && input.imageUrl.trim() !== ''
        ? input.imageUrl.trim().slice(0, 2048)
        : '',
    opacity: clamp(
      typeof input.opacity === 'number' ? input.opacity : NaN,
      0,
      100,
      DEFAULT_BACKGROUND.opacity,
    ),
    blur: clamp(
      typeof input.blur === 'number' ? input.blur : NaN,
      0,
      24,
      DEFAULT_BACKGROUND.blur,
    ),
    pages,
    stardust: input.stardust !== false, // 默认开启（兼容旧配置无该字段）
  };
}

/** 读取背景配置（DB 优先，无记录/损坏回落到默认） */
export async function getSiteBackground(): Promise<SiteBackground> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return DEFAULT_BACKGROUND;
    return normalize(JSON.parse(raw) as Partial<SiteBackground>);
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

/** 保存背景配置（双写主备，upsert），返回规范化后的配置 */
export async function saveSiteBackground(input: Partial<SiteBackground>): Promise<SiteBackground> {
  const normalized = normalize(input);
  const now = new Date();
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({ key: KEY, value: JSON.stringify(normalized), updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(normalized), updatedAt: now } }),
  );
  return normalized;
}

/**
 * 按 pathname 解析该页应渲染的背景（null = 不渲染，恢复默认）
 * - unified：全局 enabled + imageUrl
 * - pages：该页键配置存在且有图 → 用该页配置；否则 null
 */
export function resolveBackgroundForPath(
  bg: SiteBackground,
  pathname: string,
): { imageUrl: string; opacity: number; blur: number } | null {
  if (bg.mode === 'pages') {
    const pb = bg.pages[pageKeyFromPathname(pathname)];
    if (pb && pb.imageUrl) return { imageUrl: pb.imageUrl, opacity: pb.opacity, blur: pb.blur };
    return null;
  }
  if (bg.enabled && bg.imageUrl) {
    return { imageUrl: bg.imageUrl, opacity: bg.opacity, blur: bg.blur };
  }
  return null;
}
