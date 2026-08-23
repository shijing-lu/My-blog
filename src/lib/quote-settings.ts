/**
 * 首页 Hero 诗词轮播配置（DB 持久化，管理员可在线增删/调速）
 *
 * - 存储：settings 表的 `hero_quotes` 键（JSON）；
 * - 无记录/解析失败时回落到 src/lib/quotes.ts 的内置默认；
 * - 管理员悬浮窗保存后写入 DB，所有访客看到同一套配置。
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.sqlite';
import { db } from '../../db';
import { HERO_QUOTES, QUOTE_CHAR_INTERVAL_MS, QUOTE_PAUSE_MS, type QuoteConfig } from './quotes';

/** 站点设置表行 */
type SettingsRow = typeof settings.$inferSelect;

/** 配置键 */
const KEY = 'hero_quotes';

/** Hero 轮播完整配置 */
export interface HeroQuoteSettings {
  quotes: QuoteConfig[];
  /** 逐字间隔（毫秒） */
  charIntervalMs: number;
  /** 未单独设置时的默认停留（毫秒） */
  defaultPauseMs: number;
}

/** 内置默认（未配置时） */
export const DEFAULT_HERO_QUOTES: HeroQuoteSettings = {
  quotes: HERO_QUOTES,
  charIntervalMs: QUOTE_CHAR_INTERVAL_MS,
  defaultPauseMs: QUOTE_PAUSE_MS,
};

/** 数值收敛到合法区间，非法返回兜底 */
function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

/**
 * 读取 Hero 配置（DB 优先，无记录/损坏回落到默认）
 */
export async function getHeroQuoteSettings(): Promise<HeroQuoteSettings> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    const raw = rows[0]?.value;
    if (!raw) return DEFAULT_HERO_QUOTES;
    const parsed = JSON.parse(raw) as Partial<HeroQuoteSettings>;
    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_HERO_QUOTES;
  }
}

/** 规范化并校验配置（非法项剔除/兜底） */
function normalizeSettings(input: Partial<HeroQuoteSettings>): HeroQuoteSettings {
  const quotes = Array.isArray(input.quotes)
    ? input.quotes
        .filter((q): q is QuoteConfig => Boolean(q) && typeof q.text === 'string' && q.text.trim() !== '')
        .map((q) => ({
          text: q.text.trim(),
          pauseMs:
            typeof q.pauseMs === 'number' && Number.isFinite(q.pauseMs) && q.pauseMs >= 0
              ? Math.round(q.pauseMs)
              : undefined,
        }))
    : DEFAULT_HERO_QUOTES.quotes;
  return {
    quotes: quotes.length > 0 ? quotes : DEFAULT_HERO_QUOTES.quotes,
    charIntervalMs: clamp(
      typeof input.charIntervalMs === 'number' ? input.charIntervalMs : NaN,
      60,
      3000,
      DEFAULT_HERO_QUOTES.charIntervalMs,
    ),
    defaultPauseMs: clamp(
      typeof input.defaultPauseMs === 'number' ? input.defaultPauseMs : NaN,
      0,
      120000,
      DEFAULT_HERO_QUOTES.defaultPauseMs,
    ),
  };
}

/**
 * 保存 Hero 配置（upsert），返回规范化后的配置
 */
export async function saveHeroQuoteSettings(input: Partial<HeroQuoteSettings>): Promise<HeroQuoteSettings> {
  const normalized = normalizeSettings(input);
  const now = new Date();
  await db
    .insert(settings)
    .values({ key: KEY, value: JSON.stringify(normalized), updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(normalized), updatedAt: now } });
  return normalized;
}

/** 行 → 序列化（API 用） */
export function serializeSettings(s: HeroQuoteSettings): HeroQuoteSettings {
  return s;
}

export type { SettingsRow };
