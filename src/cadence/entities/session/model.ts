/**
 * 执行记录（Session）
 * 依据：01-需求文档 FR-EXEC-*；产品以"小时"为最小管理粒度
 */

import type { PlanId } from "@/cadence/entities/plan";
import type { TaskId } from "@/cadence/entities/task";
import type { Timestamped } from "@/cadence/shared/model/entity";

export type SessionId = string;

export interface Session extends Timestamped {
  id: SessionId;
  /** 关联任务；undefined 表示"临时投入"（用户直接记了一段时间，没有挂任务） */
  taskId?: TaskId | undefined;
  /** 冗余的 planId：统计"某计划总投入"时不必先查任务表再聚合（读多写少的冗余是划算的） */
  planId?: PlanId | undefined;
  startedAt: number;
  /**
   * 结束时间；undefined 表示**正在进行中**。
   * 这个语义区分是统计正确性的关键：进行中的记录时长按 now 计算，
   * 但绝不能把它当成已完成时长写进持久化统计。
   */
  endedAt?: number | undefined;
  pausedAt?: number | undefined;
  pausedMs?: number | undefined;
  note?: string | undefined;
}

/** 计算一条执行记录的有效时长（进行中的记录按到 now 为止计算） */
export function sessionDurationMs(session: Session, now: number): number {
  const end = session.endedAt ?? session.pausedAt ?? now;
  return Math.max(0, end - session.startedAt - (session.pausedMs ?? 0));
}

/** 是否为进行中的记录 */
export function isSessionActive(session: Session): boolean {
  return session.endedAt === undefined;
}
