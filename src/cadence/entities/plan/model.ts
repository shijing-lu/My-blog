/**
 * 计划实体
 * 依据：01-需求文档 FR-PLAN-*；02-技术架构文档 §4.1
 */

import type {
  Taggable,
  Timestamped,
  SoftDeletable,
} from "@/cadence/shared/model/entity";
import type { PigmentKey } from "@/cadence/shared/config/pigment";

export type PlanId = string;

/**
 * 计划状态
 *
 * archived 与 completed 分开：completed 是"做完了"（可统计进成果），
 * archived 是"不做了"（不应出现在任何进度统计里）。
 * 混用一个状态会导致"完成率"虚高。
 */
export type PlanStatus = "active" | "paused" | "completed" | "archived";

export interface Plan extends Timestamped, SoftDeletable, Taggable {
  id: PlanId;
  title: string;
  description?: string | undefined;
  status: PlanStatus;
  /**
   * 起止日期用 dateKey 而非时间戳：计划的粒度是"天"，
   * 存时间戳会引入"用户在另一个时区打开应用看到日期变了"的问题。
   */
  startDate?: string | undefined;
  endDate?: string | undefined;
  /** 颜料语义色，用于看板与图表的视觉归类 */
  color: PigmentKey;
}

/** 计划的可排序状态顺序（用于看板列顺序与统计分组） */
export const PLAN_STATUS_ORDER: readonly PlanStatus[] = [
  "active",
  "paused",
  "completed",
  "archived",
];

export function isPlanStatus(value: unknown): value is PlanStatus {
  return (
    typeof value === "string" &&
    (PLAN_STATUS_ORDER as readonly string[]).includes(value)
  );
}
