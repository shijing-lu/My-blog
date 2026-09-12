/**
 * 归档页时间线数据层（纯函数，可单测）
 *
 * 把「文章元信息列表」整理成 `/archive` 需要的三级结构：年 → 月 → 文章。
 * 全部为纯函数：不碰数据库、不读时钟，输入输出明确，便于 vitest 覆盖。
 *
 * ## 两条关键约定
 *
 * 1. **时间口径 = 北京时间**。Vercel 实例跑在 UTC，若直接用 `Date#getFullYear`
 *    这类本地 getter，凌晨发布的文章会被归到前一天/前一月（东八区 00:00–08:00
 *    对应 UTC 前一天 16:00–24:00）。故复用与 `moments.ts` 相同的
 *    `Intl.DateTimeFormat({ timeZone: 'Asia/Shanghai' })` 方案。
 *    （刻意在本文件独立实现而不导出 `moments.ts` 的私有函数，降低模块耦合。）
 *
 * 2. **排序键 = `createdAt`（发布时间），不是 `updatedAt`**。归档的语义是
 *    「什么时候发的」，而 `updatedAt` 会被任何一次编辑顶到最前、把旧文重新
 *    插进归档顶部，破坏时间线的历史感。⚠️ 注意 `listArticlePageMeta()` 默认按
 *    `updatedAt` 倒序返回，故本模块会**重新排序**，不依赖入参顺序。
 */
import type { ArticleMeta } from '../../db/types';

/** 时间线中的一个条目：文章元信息 + 定位到日/星期的北京时间部件 */
export interface TimelineEntry {
  /** 文章元信息（不含正文） */
  meta: ArticleMeta;
  /** 正文字符数（来自 SQL `length(content)` 聚合，列表不取正文） */
  contentLength: number;
  /** 北京时间年份 */
  year: number;
  /** 北京时间月份（1–12） */
  month: number;
  /** 北京时间日 */
  day: number;
  /** 星期（0=周日 … 6=周六） */
  weekday: number;
}

/** 一个月份分组 */
export interface TimelineMonth {
  /** 月份（1–12） */
  month: number;
  /** 该月文章数 */
  count: number;
  /** 该月文章（按发布时间倒序） */
  entries: TimelineEntry[];
}

/** 一个年份分组 */
export interface TimelineYear {
  /** 年份（如 2026） */
  year: number;
  /** 该年文章总数 */
  count: number;
  /** 该年各月（按月份倒序） */
  months: TimelineMonth[];
}

/** 右侧时间线导航项（对齐 `src/components/Timeline.astro` 的 props 形状） */
export interface TimelineNavItem {
  /** 锚点 id（`y-2026` / `m-2026-9`），页面中对应元素的 id */
  date: string;
  /** 展示文案（`2026 年` / `9 月`） */
  label: string;
  /** 该节点文章数 */
  count: number;
}

/**
 * 北京时间日期部件格式化器。
 *
 * `weekday: 'short'` 配合 `en-US` 得到 `Mon`/`Tue`… 需再映射成数字与中文。
 */
const BJ_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

/** `en-US` 短星期名 → 0–6（周日=0，与 `Date#getDay()` 对齐） */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** 中文星期标签（与 `WEEKDAY_INDEX` 同序） */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/**
 * Date → 北京时间 年/月/日/星期。
 *
 * @param d 任意时刻
 * @returns 北京时间的年月日与星期（星期日为 0）
 */
export function bjDateParts(d: Date): { y: number; mo: number; d: number; weekday: number } {
  const parts = Object.fromEntries(BJ_FMT.formatToParts(d).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >;
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    // 极少数运行环境可能不给 weekday（保护性回退到周日），避免整体抛错
    weekday: WEEKDAY_INDEX[parts.weekday ?? ''] ?? 0,
  };
}

/**
 * 星期数字 → 中文标签。
 *
 * @param weekday 0=周日 … 6=周六（越界回退为空串）
 */
export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? '';
}

/**
 * 字数展示（沿用首页统计条的 `x.xk` 惯例，见 `src/pages/index.astro`）。
 *
 * @param n 字符数
 */
export function formatWordCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * 把文章元信息列表整理成「年 → 月 → 文章」的倒序时间线。
 *
 * @param metas 带 `contentLength` 的文章元信息（`listArticlePageMeta` 的返回形态）
 * @returns 年份分组数组；年、月、组内条目均按发布时间倒序
 */
export function buildArticleTimeline(
  metas: Array<ArticleMeta & { contentLength: number }>,
): TimelineYear[] {
  const entries: TimelineEntry[] = metas.map(({ contentLength, ...meta }) => {
    const p = bjDateParts(meta.createdAt);
    return { meta, contentLength, year: p.y, month: p.mo, day: p.d, weekday: p.weekday };
  });

  // 发布时间倒序（不依赖入参顺序：listArticlePageMeta 给的是 updatedAt 序）
  entries.sort((a, b) => b.meta.createdAt.getTime() - a.meta.createdAt.getTime());

  // Map 的插入序 = 首次遇到的顺序 = 时间倒序 → 年/月天然有序，无需再排
  const yearMap = new Map<number, TimelineYear>();
  for (const entry of entries) {
    let year = yearMap.get(entry.year);
    if (!year) {
      year = { year: entry.year, count: 0, months: [] };
      yearMap.set(entry.year, year);
    }
    year.count += 1;

    let month = year.months.find((m) => m.month === entry.month);
    if (!month) {
      month = { month: entry.month, count: 0, entries: [] };
      year.months.push(month);
    }
    month.count += 1;
    month.entries.push(entry);
  }

  return Array.from(yearMap.values());
}

/**
 * 生成右侧时间线导航项（年 + 月的扁平列表）。
 *
 * key 形如 `y-2026` / `m-2026-9`，与 `/archive` 页面中各分组的元素 `id` 一一对应，
 * 供客户端点击滚动定位。
 *
 * @param years `buildArticleTimeline` 的结果
 */
export function timelineNavItems(years: TimelineYear[]): TimelineNavItem[] {
  const items: TimelineNavItem[] = [];
  for (const year of years) {
    items.push({ date: `y-${year.year}`, label: `${year.year} 年`, count: year.count });
    for (const month of year.months) {
      items.push({ date: `m-${year.year}-${month.month}`, label: `${month.month} 月`, count: month.count });
    }
  }
  return items;
}

/** 锚点 id 生成（与 `timelineNavItems` 的 key 保持一致，避免两处手写漂移） */
export const yearAnchorId = (year: number): string => `y-${year}`;
export const monthAnchorId = (year: number, month: number): string => `m-${year}-${month}`;
