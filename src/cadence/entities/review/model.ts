/**
 * 复盘实体（周期配置 + 周期格条目）
 * 依据：01-需求文档 FR-REVIEW-*；02-技术架构文档 §4.1 / §4.3
 */

import type {
  Taggable,
  Timestamped,
  SoftDeletable,
} from "@/cadence/shared/model/entity";

export type ReviewScheduleId = string;
export type ReviewEntryId = string;

/**
 * 复盘周期配置
 *
 * 周期格（Slot）不落库，由 `deriveSlots` 从这里派生 ——
 * 用户改了周期配置后，历史格子会按新规则重新解释，
 * 这正是"配置是因、格子是果"的正确方向。
 */
export interface ReviewSchedule extends Timestamped, SoftDeletable {
  id: ReviewScheduleId;
  title: string;
  /** 间隔小时数：2 → 一天 12 格；15 分钟粒度 = 0.25 */
  intervalHours: number;
  /**
   * 锚点偏移：锚点时区当天 00:00 起的第 offset 毫秒是第一格的起点。
   * 例如 8 小时周期 + 9 小时锚点 → 格子为 9:00/17:00/1:00...（跨夜）。
   * 用毫秒而不是"小时数"是为了支持 15 分钟粒度与任意起点。
   */
  anchorOffsetMs: number;
  /** 暂停的周期不再派生新格子，但历史条目保留 */
  enabled: boolean;
  /** 展示顺序 */
  order: number;
  /** 引导语（如"这三小时推进了什么？卡在哪里？"） */
  prompt?: string | undefined;
}

/**
 * 复盘条目 —— 归属某个具体的周期格
 *
 * 唯一约束 `[scheduleId + slotStart]` 由 Dexie 复合唯一索引保证：
 * 一个格子只能有一条复盘。这比"应用层先查再写"可靠 —— 并发下不会重复。
 */
export interface ReviewEntry extends Timestamped, Taggable, SoftDeletable {
  id: ReviewEntryId;
  scheduleId: ReviewScheduleId;
  /** 所属格子起点（UTC ms），与 scheduleId 一起构成唯一键 */
  slotStart: number;
  /** 冗余的归属日期（按格子起点计算），供按日查询与索引 */
  dateKey: string;
  content: string;
  /** 心情 1–5；undefined 表示未标记 */
  mood?: number | undefined;
}

export const MOOD_MIN = 1;
export const MOOD_MAX = 5;

export function isMood(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MOOD_MIN &&
    value <= MOOD_MAX
  );
}
