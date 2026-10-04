/**
 * 待办实体
 * 依据：01-需求文档 FR-TODO-*；关键设计决策 3（zoneId 不落库）
 */

import type {
  SoftDeletable,
  Taggable,
  Timestamped,
} from "@/cadence/shared/model/entity";

export type TodoId = string;

export type TodoStatus = "open" | "doing" | "done" | "archived";

/** XY 坐标，取值 0–100（归一化，与视口尺寸解耦） */
export interface TodoCoordinate {
  x: number;
  y: number;
}

export interface Todo extends Timestamped, SoftDeletable, Taggable {
  id: TodoId;
  title: string;
  note?: string | undefined;
  status: TodoStatus;
  /**
   * 坐标依附于某个轴配置（FR-TODO-13：同一待办可在多个轴下有各自坐标）。
   * 轴配置删除时坐标按用户选择迁移或一并清除。
   */
  axisConfigId: string;
  coordinate: TodoCoordinate;
  dueAt?: number | undefined;
}

export const TODO_STATUS_ORDER: readonly TodoStatus[] = [
  "open",
  "doing",
  "done",
  "archived",
];

export function isTodoStatus(value: unknown): value is TodoStatus {
  return (
    typeof value === "string" &&
    (TODO_STATUS_ORDER as readonly string[]).includes(value)
  );
}

/** 坐标合法性：必须是 0–100 的有限数。越界的坐标会导致分区判定与渲染错乱 */
export function isValidCoordinate(coordinate: TodoCoordinate): boolean {
  const inRange = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100;
  return inRange(coordinate.x) && inRange(coordinate.y);
}

/** 把坐标收敛回合法区间（导入旧数据 / 浮点误差时的兜底） */
export function clampCoordinate(coordinate: TodoCoordinate): TodoCoordinate {
  const clamp = (v: number) =>
    Math.min(100, Math.max(0, Number.isFinite(v) ? v : 50));
  return { x: clamp(coordinate.x), y: clamp(coordinate.y) };
}
