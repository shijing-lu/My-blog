/**
 * 日程实体（24 小时面板）
 * 依据：docs/08-日程面板.md
 * ---------------------------------------------------------------------------
 * 日程是"时间块"：一天之内的一段起止时间（分钟制，0–1440）。
 * 与执行记录（Session）的分工：Session 记录"实际发生了什么"，
 * 日程是"计划让这段时间做什么"——两者通过 note/关联互相对照，不合并。
 *
 * 跨午夜：v1 刻意不支持跨天事件（00:00–24:00 内 clamp）——
 * 单日面板 + 跨天事件会把所有消费方拖进日期边界的泥潭，价值不匹配。
 */

import type { Timestamped } from "@/cadence/shared/model/entity";

export type ScheduleEventId = string;

/** 关联来源：今日计划项 / 任务 / 自由日程 */
export type ScheduleRefKind = "plan-item" | "task" | "free";

export interface ScheduleEvent extends Timestamped {
  id: ScheduleEventId;
  /** 业务键：锚点时区钟表日 */
  dateKey: string;
  /** 当天分钟数，0–1440，左闭右开 [startMin, endMin) */
  startMin: number;
  endMin: number;
  title: string;
  note?: string | undefined;
  refKind?: ScheduleRefKind | undefined;
  refId?: string | undefined;
  done: boolean;
}

/** 最小时长 15 分钟（与拖拽吸附粒度一致）；上限一整天 */
export const MIN_DURATION_MIN = 15;
export const DAY_TOTAL_MIN = 24 * 60;

/** 拖拽/新建的时间吸附粒度（业界标准 15 分钟） */
export const SNAP_MIN = 15;

export function snapDown(min: number): number {
  return Math.floor(min / SNAP_MIN) * SNAP_MIN;
}

/** clamp 到 [0, 1440] 并保证时长合法；越界即收敛，不抛错 */
export function clampSpan(
  startMin: number,
  endMin: number,
): { startMin: number; endMin: number } {
  const s = Math.min(
    Math.max(0, snapDown(startMin)),
    DAY_TOTAL_MIN - MIN_DURATION_MIN,
  );
  const rawEnd = Math.min(
    Math.max(endMin, s + MIN_DURATION_MIN),
    DAY_TOTAL_MIN,
  );
  const e = Math.max(snapDown(rawEnd), s + MIN_DURATION_MIN);
  return { startMin: s, endMin: Math.min(e, DAY_TOTAL_MIN) };
}

/** 是否与已有日程重叠（左闭右开：首尾相接不算重叠） */
export function overlaps(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number },
): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** 新建日程的确定性 id（dateKey + 起始分钟派生，同一天同时刻唯一） */
export function scheduleEventIdOf(
  dateKey: string,
  startMin: number,
  seq: number,
): ScheduleEventId {
  return `sev_${dateKey.replace(/-/g, "")}_${startMin}_${seq.toString(36)}`;
}
