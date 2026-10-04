/**
 * 时间纯函数（锚点时区）
 * ---------------------------------------------------------------------------
 * 设计约束：**全部是纯函数，绝不调用 new Date() 取"现在"**。
 * 时间坐标一律由调用方显式传入 —— 这是派生逻辑可测试的前提
 * （技术文档 §4.3：deriveSlots 不读数据库、不读系统时间）。
 *
 * 为什么自己实现而不是用 date-fns 的时区模块：
 *   date-fns-tz 需要 IANA 时区名与完整的 tz 数据（几十 KB）。
 *   本项目的时间语义只需要「锚点时区的日界」，用固定偏移分钟数即可表达，
 *   不需要处理夏令时（见下方说明）。省下一个依赖和它的体积。
 *
 * 夏令时说明：用固定偏移意味着在夏令时切换日，"一天的长度"可能不是 24h。
 * 对本产品而言这是可接受甚至更正确的行为 —— 用户关心的是"当地钟表上的这一天"。
 */

/** UTC ms → 'YYYY-MM-DD'（按锚点时区的钟表时间） */
export function dateKeyOf(ms: number, tzOffsetMinutes: number): string {
  const shifted = new Date(ms + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 锚点时区下某一天的 00:00 对应的 UTC ms */
export function startOfDayMs(dateKey: string, tzOffsetMinutes: number): number {
  const { y, m, d } = parseDateKey(dateKey);
  return Date.UTC(y, m - 1, d) - tzOffsetMinutes * 60_000;
}

/** 锚点时区下某一天的结束（即次日的 00:00），左闭右开区间的右端 */
export function endOfDayMs(dateKey: string, tzOffsetMinutes: number): number {
  return startOfDayMs(dateKey, tzOffsetMinutes) + 86_400_000;
}

/** 'YYYY-MM-DD' → { y, m, d }；非法输入直接抛错（这是编程错误，不是运行时状态） */
export function parseDateKey(dateKey: string): {
  y: number;
  m: number;
  d: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`非法的日期键：${dateKey}（期望 YYYY-MM-DD）`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error(`非法的日期键：${dateKey}（月份或日期越界）`);
  }
  return { y, m, d };
}

/** 日期键加 n 天（跨月、跨年由 Date.UTC 自动处理） */
export function addDays(
  dateKey: string,
  days: number,
  tzOffsetMinutes: number,
): string {
  return dateKeyOf(
    startOfDayMs(dateKey, tzOffsetMinutes) + days * 86_400_000,
    tzOffsetMinutes,
  );
}

/** UTC ms → 'HH:mm'（锚点时区钟表时间），用于时间轴展示 */
export function clockOf(ms: number, tzOffsetMinutes: number): string {
  const shifted = new Date(ms + tzOffsetMinutes * 60_000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

/** 时长 → 人类可读（"2 小时 15 分" / "45 分" / "30 秒"） */
export function formatDuration(ms: number): string {
  if (ms < 0) return "0 秒";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`;
}

/**
 * 本地时区偏移（分钟，东八区 = +480）
 *
 * 用作锚点时区的默认值。注意 Date.getTimezoneOffset() 的符号与直觉相反
 * （UTC+8 返回 -480），所以取反。
 */
export function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** 一天的毫秒数，命名常量避免魔法数字满天飞 */
export const DAY_MS = 86_400_000;
