/**
 * 站点背景配置（全站背景层：开启 / 图片 / 透明度 / 模糊度）
 *
 * - 存储：settings 表 `site_background` 键（JSON），管理员在 /admin/settings 配置；
 * - 读取：BaseLayout 服务端读取并渲染背景层，全站一致、零 JS；
 * - 未配置时默认关闭。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db } from '../../db';

/** 背景配置 */
export interface SiteBackground {
  /** 是否开启背景层 */
  enabled: boolean;
  /** 背景图 URL（http(s) 或站内路径） */
  imageUrl: string;
  /** 背景透明度 0-100（%） */
  opacity: number;
  /** 背景模糊度 0-24（px） */
  blur: number;
}

/** 配置键 */
const KEY = 'site_background';

/** 默认（关闭） */
export const DEFAULT_BACKGROUND: SiteBackground = {
  enabled: false,
  imageUrl: '',
  opacity: 50,
  blur: 0,
};

/** 数值收敛到合法区间 */
function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

/** 规范化校验 */
function normalize(input: Partial<SiteBackground>): SiteBackground {
  return {
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

/** 保存背景配置（upsert），返回规范化后的配置 */
export async function saveSiteBackground(input: Partial<SiteBackground>): Promise<SiteBackground> {
  const normalized = normalize(input);
  const now = new Date();
  await db
    .insert(settings)
    .values({ key: KEY, value: JSON.stringify(normalized), updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(normalized), updatedAt: now } });
  return normalized;
}
