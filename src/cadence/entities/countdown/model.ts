/**
 * 倒计时实体（总览页顶部 hero）
 * 依据：docs/10-倒计时.md
 * ---------------------------------------------------------------------------
 * 模型选择（为什么不是"目标日期"）：
 *   用户要求"按分钟 / 小时 / 天来倒计时"——这是**时长语义**（从现在起 N 个单位），
 *   而不是日历日期语义。于是存 `targetAt`（目标时刻的 UTC ms），
 *   由"设置时刻 + 数量 × 单位"一次算出：模型里没有"数量"和"单位"的真相来源，
 *   只有目标时刻 —— 这样"续时/暂停/重设"都是对同一字段的确定性运算，
 *   也不会出现"存了 3 天，但创建时是昨天"这类漂移。
 *
 * 暂停的实现：把剩余毫秒快照进 `pausedRemainingMs`。恢复时 targetAt = now + 快照。
 * 归零：不自动删除（用户可能想看着它停在 0 或者续时），只是剩余为 0。
 */

import type { PigmentKey } from "@/cadence/shared/config/pigment";
import type { SoftDeletable, Timestamped } from "@/cadence/shared/model/entity";

export type CountdownUnit = "minute" | "hour" | "day";

export interface Countdown extends Timestamped, SoftDeletable {
  id: string;
  /** 自定义名称，如"考研" */
  name: string;
  /** 预设单位：既用于展示，也是"+1 单位"续时的粒度 */
  unit: CountdownUnit;
  /** 目标时刻（UTC ms） */
  targetAt: number;
  /** 暂停中：剩余毫秒快照；undefined = 运行中 */
  pausedRemainingMs?: number | undefined;
  /** 颜料键（多条倒计时用不同色区分） */
  color: PigmentKey;
  /** 展示顺序（越小越靠前） */
  order: number;
}

export const UNIT_MS: Record<CountdownUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export const UNIT_LABEL: Record<CountdownUnit, string> = {
  minute: "分钟",
  hour: "小时",
  day: "天",
};

/** 单位 → 毫秒；非法数量（≤0 / 非有限数）返回 undefined，由调用方拒绝 */
export function durationMsOf(
  amount: number,
  unit: CountdownUnit,
): number | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const ms = amount * UNIT_MS[unit];
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.round(ms);
}

/**
 * 「日历日期 + 当天时:分」→ 目标时刻（UTC ms）。纯函数，不读系统时钟。
 * ---------------------------------------------------------------------------
 * 日历模式（用户用日期选择器指定哪天几点结束）与时长模式（从此刻起 N 个单位）
 * 最终都归一到同一个 `targetAt` —— 模型里始终只有一个真相来源。
 *
 * `dateKey` 用锚点时区的 'YYYY-MM-DD'，`clock` 用 'HH:mm'。
 * 校验失败返回 undefined，由调用方拒绝（不静默降级成"现在"）。
 */
export function targetAtOfDateTime(
  dateKey: string,
  clock: string,
  tzOffsetMinutes: number,
): number | undefined {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const cm = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!dm || !cm) return undefined;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(cm[1]);
  const mi = Number(cm[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  if (h > 23 || mi > 59) return undefined;
  // 该锚点时区钟点对应的 UTC ms：先按 UTC 拼出钟表时间，再减去偏移
  return Date.UTC(y, mo - 1, d, h, mi) - tzOffsetMinutes * 60_000;
}

/** UTC ms → 锚点时区的 'HH:mm'（日历模式的初值用） */
export function clockOfMs(ms: number, tzOffsetMinutes: number): string {
  const shifted = new Date(ms + tzOffsetMinutes * 60_000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

/** UTC ms → 锚点时区的 'YYYY-MM-DD' */
export function dateKeyOfMs(ms: number, tzOffsetMinutes: number): string {
  const shifted = new Date(ms + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 剩余毫秒（暂停中读快照；归零后恒为 0，不出现负数） */
export function remainingMsOf(countdown: Countdown, now: number): number {
  if (countdown.pausedRemainingMs !== undefined)
    return Math.max(0, countdown.pausedRemainingMs);
  return Math.max(0, countdown.targetAt - now);
}

export function isPaused(countdown: Countdown): boolean {
  return countdown.pausedRemainingMs !== undefined;
}

export function isFinished(countdown: Countdown, now: number): boolean {
  return remainingMsOf(countdown, now) === 0;
}

/** 剩余时长拆解（大数字展示用） */
export interface CountdownBreakdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function breakdownOf(remainingMs: number): CountdownBreakdown {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** "3 天" / "1 小时" 这类人类可读的量词短语 */
export function describeAmount(amount: number, unit: CountdownUnit): string {
  return `${amount} ${UNIT_LABEL[unit]}`;
}

/**
 * 主数字：**按用户设置的单位**换算，而不是按剩余量自动降档。
 * ---------------------------------------------------------------------------
 * 这是用户明确要求的显示纪律："我设的是小时，就该按小时告诉我"。
 * 早先的实现是「有整天显示天、不足一天显示小时」——结果是设 3 小时却显示
 * "3 天"，用户读到的精度和自己设的精度对不上，等于设置白做了。
 *
 * 换算用**向下取整**（还剩 2.9 小时 → "2 小时"）：取整到"已完整度过的单位"，
 * 与倒计时"还没到"的语义一致，也不会出现 3 小时的倒计时一开头就显示 "3 小时"
 * 却整段停留在 "3" 的错觉。
 *
 * 返回 `{ value, unit }` 供 UI 直接渲染；`value` 为该单位下的整数量。
 */
export function primaryOf(
  remainingMs: number,
  unit: CountdownUnit,
): { value: number; unit: string } {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const value =
    unit === "day"
      ? Math.floor(totalSeconds / 86_400)
      : unit === "hour"
        ? Math.floor(totalSeconds / 3600)
        : Math.floor(totalSeconds / 60);
  return { value, unit: UNIT_LABEL[unit] };
}

/**
 * 精确剩余文本：按**用户设定单位**给出"共多少单位 (+ 零头)"，如
 *   100 天 3 小时 / 3 小时 12 分 / 45 分 12 秒 / 已结束
 * 与 `formatRemaining` 的区别：后者按量级自动选档（AI 播报用，泛化场景），
 * 这里跟随 `unit`，是卡片正文用的"精度一致"版本。
 */
export function formatRemainingIn(
  remainingMs: number,
  unit: CountdownUnit,
): string {
  if (remainingMs <= 0) return "已结束";
  const { days, hours, minutes } = breakdownOf(remainingMs);
  // 主单位的整数部分：天=天；小时=天*24+时；分钟=天*1440+时*60+分
  const head =
    unit === "day"
      ? days
      : unit === "hour"
        ? days * 24 + hours
        : (days * 24 + hours) * 60 + minutes;
  const tail = tailOf(remainingMs, unit);
  if (head > 0)
    return tail.length > 0
      ? `${head} ${UNIT_LABEL[unit]} ${tail}`
      : `${head} ${UNIT_LABEL[unit]}`;
  return tail;
}

/**
 * 主单位之后的零头（比主单位小一级的单位）。
 * 主单位是「天」→ 零头取小时/分；「小时」→ 分/秒；「分钟」→ 秒。
 * 返回空串表示无零头（如整 3 小时）。
 */
function tailOf(remainingMs: number, unit: CountdownUnit): string {
  const { days, hours, minutes, seconds } = breakdownOf(remainingMs);
  if (unit === "day") {
    if (days === 0)
      return hours > 0
        ? `${hours} 小时`
        : minutes > 0
          ? `${minutes} 分`
          : `${seconds} 秒`;
    return hours > 0 ? `${hours} 小时` : minutes > 0 ? `${minutes} 分` : "";
  }
  if (unit === "hour") {
    if (days * 24 + hours === 0)
      return minutes > 0 ? `${minutes} 分` : `${seconds} 秒`;
    return minutes > 0 ? `${minutes} 分` : "";
  }
  return seconds > 0 ? `${seconds} 秒` : "";
}
/** 剩余时长的紧凑文本（AI 播报与列表用）："2 天 3 小时" / "45 分钟" / "已结束" */
export function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return "已结束";
  const { days, hours, minutes } = breakdownOf(remainingMs);
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  if (hours > 0)
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  if (minutes > 0) return `${minutes} 分`;
  return "不到 1 分钟";
}

/**
 * 多条倒计时的颜料轮转。
 * 注意用**语义键**（PigmentKey：plan/todo/session/review/archive）而不是美术色名 ——
 * 全站唯一的取色入口是 pigment.ts（红线 C5），这里只是挑几个语义色来区分条目。
 * 确定性：按已有条数取模，不用随机。
 */
export const COUNTDOWN_COLORS: readonly PigmentKey[] = [
  "todo",
  "plan",
  "session",
  "review",
  "archive",
];

export function nextColorOf(existing: readonly Countdown[]): PigmentKey {
  const index = existing.length % COUNTDOWN_COLORS.length;
  return COUNTDOWN_COLORS[index] ?? "todo";
}
