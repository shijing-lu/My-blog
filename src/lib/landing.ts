/**
 * 落地页 Hero 配置（自定义头图轮播 + 副标题）
 *
 * - 存储：settings 表 `site_landing_hero` 键（JSON）；
 * - 读取：首页服务端读取，`images` 非空时用它覆盖「最新文章封面」；多图按 `intervalSec`
 *   轮换（`animation`：slide 从右向左滑入 / break 破碎浮现）；`subtitle` 为 Hero 副标题；
 * - 页面：/admin/settings 的「落地页」分区可上传多图、调间隔/动画、改副标题或恢复默认；
 * - 图片本身走 /api/images（R2），此处只存 URL 引用；
 * - 兼容：旧配置 `{ imageUrl }` 读取时自动迁移为单元素 `images`。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db, dbWrite } from '../../db';

/** 落地页 Hero 配置 */
export interface LandingHero {
  /** 自定义头图 URL 列表（空 = 使用文章封面） */
  images: string[];
  /** 轮换间隔（秒，2-60） */
  intervalSec: number;
  /** 轮换动画：slide=右往左滑入 / break=破碎浮现 */
  animation: 'slide' | 'break';
  /** 副标题（空 = 显示默认文案） */
  subtitle: string;
}

/** 配置键 */
const KEY = 'site_landing_hero';

/** 默认（未自定义） */
export const DEFAULT_LANDING: LandingHero = {
  images: [],
  intervalSec: 6,
  animation: 'slide',
  subtitle: '',
};

/** 默认副标题（页面兜底文案） */
export const DEFAULT_SUBTITLE = '全面自由地发展吧，同志！让我们用知识武装自己，打败世间一切邪祟。';

/** 规范化校验 */
function normalize(input: Partial<LandingHero> & { imageUrl?: string }): LandingHero {
  // 兼容旧字段 imageUrl → 迁移为 images
  let images: string[];
  if (Array.isArray(input.images)) {
    images = input.images
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim().slice(0, 2048))
      .filter(Boolean)
      .slice(0, 20);
  } else if (typeof input.imageUrl === 'string' && input.imageUrl.trim() !== '') {
    images = [input.imageUrl.trim().slice(0, 2048)];
  } else {
    images = [];
  }
  const rawInterval = typeof input.intervalSec === 'number' ? input.intervalSec : NaN;
  return {
    images,
    intervalSec: Number.isFinite(rawInterval)
      ? Math.min(60, Math.max(2, Math.round(rawInterval)))
      : DEFAULT_LANDING.intervalSec,
    animation: input.animation === 'break' ? 'break' : 'slide',
    subtitle:
      typeof input.subtitle === 'string' ? input.subtitle.trim().slice(0, 200) : '',
  };
}

/** 读取落地页 Hero 配置（DB 优先，无记录/损坏回落到默认） */
export async function getLandingHero(): Promise<LandingHero> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return DEFAULT_LANDING;
    return normalize(JSON.parse(raw) as Partial<LandingHero> & { imageUrl?: string });
  } catch {
    return DEFAULT_LANDING;
  }
}

/** 保存落地页 Hero 配置（双写主备，upsert），返回规范化后的配置 */
export async function saveLandingHero(
  input: Partial<LandingHero> & { imageUrl?: string },
): Promise<LandingHero> {
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
