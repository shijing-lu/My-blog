/**
 * 周期格（Slot）派生 —— 本项目数据模型的核心
 * 依据：01-需求文档 关键设计决策 1、FR-REVIEW-*；02-技术架构文档 §4.3
 *
 * 设计要点：
 *   1. **纯函数**：不读数据库、不读系统时间。时间坐标由 `dateKey` 显式给出，
 *      时区由 `tzOffsetMinutes` 显式给出 —— 因此任何一天、任何时区的派生结果
 *      都可以在单元测试里精确断言。
 *   2. **格子不落库**：复盘条目只存 `slotStart`，格子由配置现场派生。
 *      用户改周期配置后，历史条目按新规则重新解释（配置是因、格子是果）。
 *   3. **左闭右开**：`ts >= start && ts < end`。执行记录归属格子的判定
 *      与分区判定共用同一约定，杜绝边界歧义。
 */

import type { ReviewSchedule, ReviewScheduleId } from "./model";
import {
  DAY_MS,
  dateKeyOf,
  endOfDayMs,
  startOfDayMs,
} from "@/cadence/shared/db/time";

export interface Slot {
  scheduleId: ReviewScheduleId;
  /** 格子起点（UTC ms） */
  start: number;
  /** 格子终点（UTC ms），恒有 end - start === stepMs */
  end: number;
  /** 归属日期（按格子起点计算，锚点时区） */
  dateKey: string;
  /** 当天第几格，从 0 开始 */
  index: number;
}

/** 单日格子数上限。防止极端配置（如 0.01 小时粒度）一次性派生出上万格冻死 UI */
export const MAX_SLOTS_PER_DAY = 500;

/**
 * 由「周期配置 + 日期」派生当天的所有周期格
 *
 * @param schedule 周期配置（intervalHours / anchorOffsetMs）
 * @param dateKey  哪一天（锚点时区的钟表日期）
 * @param tzOffsetMinutes 锚点时区偏移（分钟，东八区 = 480）
 */
export function deriveSlots(
  schedule: ReviewSchedule,
  dateKey: string,
  tzOffsetMinutes: number,
): Slot[] {
  const stepMs = schedule.intervalHours * 3_600_000;
  if (!(stepMs > 0)) return []; // intervalHours 非法（0 / 负数 / NaN）→ 没有格子可派生

  const dayStart = startOfDayMs(dateKey, tzOffsetMinutes);
  const dayEnd = endOfDayMs(dateKey, tzOffsetMinutes);

  // 锚点归一化到一天之内：用户填 26 小时应等价于 2 小时，
  // 否则"锚点偏移"会随天数累积漂移，格子与日期的对应关系变得不可预测
  const anchorOffset = ((schedule.anchorOffsetMs % DAY_MS) + DAY_MS) % DAY_MS;
  const anchor = startOfDayMs(dateKey, tzOffsetMinutes) + anchorOffset;

  // 第一格：网格上满足 start + stepMs > dayStart 的最小 start。
  // 直接解不等式而不是从 anchor - 24h 开始逐格试探 —— 后者在超长周期（如 36 小时）
  // 下会漏格，且循环次数不受配置约束。
  const n = Math.floor((dayStart - stepMs - anchor) / stepMs) + 1;
  const firstStart = anchor + n * stepMs;

  const slots: Slot[] = [];
  for (let start = firstStart; start < dayEnd; start += stepMs) {
    if (slots.length >= MAX_SLOTS_PER_DAY) break;
    slots.push({
      scheduleId: schedule.id,
      start,
      end: start + stepMs,
      // 格子的归属日按**它自己的起点**算：跨夜的格子归到起点那天，
      // 这样"9:00–17:00 的格子"与"1:00–9:00 的格子"不会同日竞争同一个 index
      dateKey: dateKeyOf(start, tzOffsetMinutes),
      index: slots.length,
    });
  }

  return slots;
}

/** 某时刻属于哪个格子 —— 用于把执行记录归入周期。左闭右开 */
export function slotOf(slots: readonly Slot[], ts: number): Slot | undefined {
  return slots.find((slot) => ts >= slot.start && ts < slot.end);
}

/**
 * 周期格的唯一键（与 Dexie 的复合唯一索引 [scheduleId+slotStart] 对应）
 * 统一从这里生成，避免手拼字符串漏掉前缀。
 */
export function slotKey(
  scheduleId: ReviewScheduleId,
  slotStart: number,
): string {
  return `${scheduleId}@${slotStart}`;
}

/** 找到某个格子对应的条目（O(n)，格子数 ≤ 500，无需建索引） */
export function entryOfSlot<
  T extends { scheduleId: ReviewScheduleId; slotStart: number },
>(
  entries: readonly T[],
  scheduleId: ReviewScheduleId,
  slotStart: number,
): T | undefined {
  const key = slotKey(scheduleId, slotStart);
  return entries.find(
    (entry) => slotKey(entry.scheduleId, entry.slotStart) === key,
  );
}
