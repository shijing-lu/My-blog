/**
 * 任务实体（计划的下级拆解）
 * 依据：01-需求文档 FR-PLAN-04（计划 → 任务树，可无限嵌套）
 */

import type { PlanId } from "@/cadence/entities/plan";
import type {
  SoftDeletable,
  Taggable,
  Timestamped,
} from "@/cadence/shared/model/entity";

export type TaskId = string;

export type TaskStatus = "todo" | "doing" | "done" | "blocked";

export interface Task extends Timestamped, SoftDeletable, Taggable {
  id: TaskId;
  /** 所属计划；删除计划时任务一并软删除（级联，见 repo/soft-delete.ts） */
  planId: PlanId;
  /** 父任务 id；undefined 表示顶层任务 */
  parentId?: TaskId | undefined;
  title: string;
  note?: string | undefined;
  status: TaskStatus;
  /**
   * 手动排序值。用 number 而非数组下标：
   * 拖拽排序时取相邻两项的中点即可落位，不需要重排整个列表。
   */
  order: number;
  /** 预估时长（分钟）；undefined 表示未预估 —— 统计"实际/预估"比时必须区分这两种情况 */
  estimateMinutes?: number | undefined;
  /** 截止时间（UTC ms）；undefined 表示无截止 */
  dueAt?: number | undefined;
}

export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  "todo",
  "doing",
  "blocked",
  "done",
];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUS_ORDER as readonly string[]).includes(value)
  );
}
