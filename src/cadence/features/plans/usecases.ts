/**
 * 计划模块用例层
 * ---------------------------------------------------------------------------
 * 为什么用例层在 features 而不是 entities：
 *   用例要调用 Repository（data 层），而 entities 不得引用 data ——
 *   依赖方向只允许 features → data → entities。
 *
 * 传入依赖而不是模块内 import db：
 *   同一组用例在测试里吃内存实现 / fake-indexeddb 实现，
 *   在打包目标（Tauri SQLite）里吃 SQLite 实现 —— 接口不变。
 *   代价是每个函数多一个参数，换来的是用例层完全可测、可移植。
 */

import type { Plan, PlanStatus } from "@/cadence/entities/plan";
import type { Task } from "@/cadence/entities/task";
import type { PigmentKey } from "@/cadence/shared/config/pigment";
import { NOT_DELETED, newEntityId } from "@/cadence/shared/model/entity";
import type { CadenceDatabase } from "@/cadence/data/db/database";
import {
  DexieSoftDeleteRepo,
  DexieTaskRepo,
} from "@/cadence/data/repo/dexie-repos";
import type { SoftDeleteRepository } from "@/cadence/data/repo/types";

export interface PlanDraft {
  title: string;
  description?: string | undefined;
  color?: PigmentKey;
  tags?: string[];
  startDate?: string | undefined;
  endDate?: string | undefined;
}

/**
 * 计划用例需要的任务仓储能力
 *
 * 直接引 data 层的仓储类型，而不是引 `features/tasks` 的 TaskDeps ——
 * features 层内禁止跨切片运行时引用（会形成环），
 * 而"删计划要级联删任务"这个语义本就属于计划用例自己。
 */
export type PlanTaskRepo = SoftDeleteRepository<Task> & {
  byPlan(planId: string): Promise<Task[]>;
};

export interface PlanDeps {
  plans: SoftDeleteRepository<Plan>;
  tasks: PlanTaskRepo;
}

/** 组装默认依赖（生产环境用 Dexie 实现） */
export function createPlanDeps(database: CadenceDatabase): PlanDeps {
  return {
    plans: new DexieSoftDeleteRepo<Plan>(database, database.plans),
    tasks: new DexieTaskRepo(database),
  };
}

/** 创建计划 */
export async function createPlan(
  deps: PlanDeps,
  draft: PlanDraft,
  now: number,
): Promise<Plan> {
  return deps.plans.put(
    {
      id: newEntityId("plan", now),
      title: draft.title,
      description: draft.description,
      status: "active",
      tags: draft.tags ?? [],
      color: draft.color ?? "plan",
      startDate: draft.startDate,
      endDate: draft.endDate,
      deletedAt: NOT_DELETED,
      createdAt: now,
      updatedAt: now,
    },
    now,
  );
}

/** 更新计划（只改内容字段；状态与软删除走各自的用例，避免一条函数承担多种语义） */
export async function updatePlanDetails(
  deps: PlanDeps,
  id: string,
  draft: PlanDraft,
  now: number,
): Promise<void> {
  const existing = await deps.plans.get(id);
  if (existing === undefined) throw new Error(`计划不存在：${id}`);
  await deps.plans.put({ ...existing, ...draft, updatedAt: now }, now);
}

/** 切换计划状态（active / paused / completed / archived） */
export async function changePlanStatus(
  deps: PlanDeps,
  id: string,
  status: PlanStatus,
  now: number,
): Promise<void> {
  const existing = await deps.plans.get(id);
  if (existing === undefined) throw new Error(`计划不存在：${id}`);
  await deps.plans.put({ ...existing, status, updatedAt: now }, now);
}

/**
 * 软删除计划 —— **级联软删除其下全部任务**
 *
 * 依据 01-需求文档：计划删除进回收站保留 30 天。
 * 任务跟着进回收站（而不是彻底删除）：恢复计划时任务才能一起回来，
 * 否则"恢复了一个空计划"比"删除失败"更让用户困惑。
 *
 * @returns 被级联软删除的任务数（供 toast 提示）
 */
export async function deletePlan(
  deps: PlanDeps,
  id: string,
  now: number,
): Promise<number> {
  const tasks = await deps.tasks.byPlan(id);
  await deps.plans.softDelete(id, now);
  for (const task of tasks) {
    await deps.tasks.softDelete(task.id, now);
  }
  return tasks.length;
}

/** 从回收站恢复计划（连带恢复其全部任务） */
export async function restorePlan(
  deps: PlanDeps,
  id: string,
  now: number,
): Promise<void> {
  await deps.plans.restore(id, now);
  const tasks = await deps.tasks.byPlan(id);
  for (const task of tasks) {
    await deps.tasks.restore(task.id, now);
  }
}
