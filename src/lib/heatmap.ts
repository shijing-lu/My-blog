/**
 * 首页文章活跃热力图 + 月度写作量（纯函数，可单测）
 *
 * - 活跃日：某篇文章在其 createdAt（发布日）或 updatedAt（最后更新日）当天视为活跃，
 *   同篇同日去重；每天数值 = 当天活跃的不重复文章数。
 * - 网格：以「今天」为终点，往前 months 个月，起始对齐到周日（周日-周六 每列一周）。
 * - 月度：从起始月到当前月逐月聚合。
 */
import { countChars } from './reading';

/** 某天的活跃数 */
export interface HeatmapDay {
  /** 本地时区 YYYY-MM-DD */
  date: string;
  count: number;
}

/** 月度聚合点 */
export interface MonthlyPoint {
  /** YYYY-MM */
  month: string;
  total: number;
}

/** 顶部统计 */
export interface HeatmapStats {
  /** 文章总数 */
  posts: number;
  /** 有活动的天数 */
  days: number;
  /** 文章总字数（去空白） */
  words: number;
}

/** 热力图完整数据 */
export interface HeatmapData {
  /** 网格起始日期（周日，YYYY-MM-DD） */
  startDate: string;
  /** 今天（YYYY-MM-DD） */
  endDate: string;
  /** 按周分组的每日数据（周日开头），约 53 列 */
  weeks: HeatmapDay[][];
  /** 月度聚合（旧 → 新，共 months 个月） */
  monthly: MonthlyPoint[];
  stats: HeatmapStats;
}

/** 本地时区 YYYY-MM-DD */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 加天数（不跨月问题由 Date 自动处理） */
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * 构建首页热力图数据
 *
 * @param articles 文章（仅取 createdAt / updatedAt / content 即可）
 * @param end 统计终点（通常 new Date()，注入便于测试）
 * @param months 统计月数（默认 12）
 */
export function buildHeatmap(
  articles: ReadonlyArray<{ createdAt: Date; updatedAt: Date; content: string }>,
  end: Date,
  months = 12,
): HeatmapData {
  const posts = articles.length;
  const words = articles.reduce((sum, a) => sum + countChars(a.content), 0);

  // stats['days']：有活动的不重复日期数
  const dayIds = new Map<string, Set<number>>();
  articles.forEach((a, idx) => {
    const dates = new Set([dateKey(a.createdAt), dateKey(a.updatedAt)]);
    dates.forEach((k) => {
      if (!dayIds.has(k)) dayIds.set(k, new Set());
      dayIds.get(k)!.add(idx);
    });
  });
  const days = [...dayIds.values()].filter((s) => s.size > 0).length;

  // 起始：往前 months-1 个月的 1 号（旧），终点为当前月
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // 网格起点：start 所在周的周日（周日=0）。复制一份，避免污染后续 monthly 使用的 start
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  // 生成按周分组的每日数据
  const weeks: HeatmapDay[][] = [];
  let cursor = new Date(gridStart);
  while (cursor.getTime() <= endDay.getTime()) {
    const week: HeatmapDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const day = addDays(cursor, d);
      const k = dateKey(day);
      week.push({ date: k, count: dayIds.get(k)?.size ?? 0 });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }

  // 月度聚合（旧 → 新）
  const monthly: MonthlyPoint[] = [];
  const mCursor = new Date(start);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (mCursor.getTime() <= lastMonth.getTime()) {
    const mk = `${mCursor.getFullYear()}-${String(mCursor.getMonth() + 1).padStart(2, '0')}`;
    let total = 0;
    weeks.forEach((week) => week.forEach((day) => {
      if (day.date.startsWith(mk)) total += day.count;
    }));
    monthly.push({ month: mk, total });
    mCursor.setMonth(mCursor.getMonth() + 1);
  }

  return {
    startDate: dateKey(gridStart),
    endDate: dateKey(end),
    weeks,
    monthly,
    stats: { posts, days, words },
  };
}
