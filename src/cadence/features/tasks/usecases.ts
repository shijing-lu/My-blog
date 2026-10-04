/**
 * 任务模块用例层
 */

import type { Task, TaskStatus } from "@/cadence/entities/task";
import { NOT_DELETED, newEntityId } from "@/cadence/shared/model/entity";
import type { CadenceDatabase } from "@/cadence/data/db/database";
import { DexieTaskRepo } from "@/cadence/data/repo/dexie-repos";
import type { SoftDeleteRepository } from "@/cadence/data/repo/types";
import {
  canHaveChildren,
  descendantIds,
  orderAtEnd,
  type TaskNode,
} from "./tree";

export interface TaskDeps {
  tasks: SoftDeleteRepository<Task> & {
    byPlan(planId: string): Promise<Task[]>;
  };
}

export function createTaskDeps(database: CadenceDatabase): TaskDeps {
  return { tasks: new DexieTaskRepo(database) };
}

export interface TaskDraft {
  title: string;
  note?: string | undefined;
  estimateMinutes?: number | undefined;
  dueAt?: number | undefined;
  tags?: string[];
}

/** 新建顶层任务（挂在计划下） */
export async function createTask(
  deps: TaskDeps,
  planId: string,
  draft: TaskDraft,
  now: number,
): Promise<Task> {
  const siblings = await deps.tasks.byPlan(planId);
  return deps.tasks.put(
    {
      id: newEntityId("task", now),
      planId,
      title: draft.title,
      note: draft.note,
      status: "todo",
      order: orderAtEnd(siblings.filter((task) => task.parentId === undefined)),
      tags: draft.tags ?? [],
      estimateMinutes: draft.estimateMinutes,
      dueAt: draft.dueAt,
      deletedAt: NOT_DELETED,
      createdAt: now,
      updatedAt: now,
    },
    now,
  );
}

/**
 * 新建子任务
 *
 * 层级上限 3 层。越界的请求**抛错而不是静默降级**：
 * 用户点"添加子任务"按钮没反应，比看到明确提示更糟。
 */
export async function createSubtask(
  deps: TaskDeps,
  parent: TaskNode,
  ancestors: readonly TaskNode[],
  draft: TaskDraft,
  now: number,
): Promise<Task> {
  if (!canHaveChildren(ancestors)) {
    throw new Error(
      `任务层级已达上限（3 层）：「${parent.task.title}」下不能再建子任务`,
    );
  }

  const siblings = await deps.tasks.byPlan(parent.task.planId);
  return deps.tasks.put(
    {
      id: newEntityId("task", now),
      planId: parent.task.planId,
      parentId: parent.task.id,
      title: draft.title,
      note: draft.note,
      status: "todo",
      order: orderAtEnd(
        siblings.filter((task) => task.parentId === parent.task.id),
      ),
      tags: draft.tags ?? [],
      estimateMinutes: draft.estimateMinutes,
      dueAt: draft.dueAt,
      deletedAt: NOT_DELETED,
      createdAt: now,
      updatedAt: now,
    },
    now,
  );
}

/**
 * 勾选任务完成状态
 *
 * 联动规则（M3 简化版）：勾掉父任务**不**自动勾掉子任务 ——
 * "父任务完成"的语义是产品决策，需要先回答"有子任务未完成时父任务能否完成"，
 * 这个交互问题留到真实使用后再定。现在只改这一个任务的状态。
 */
export async function setTaskStatus(
  deps: TaskDeps,
  task: Task,
  status: TaskStatus,
  now: number,
): Promise<void> {
  await deps.tasks.put({ ...task, status, updatedAt: now }, now);
}

/**
 * 更新任务详情（标题 / 备注）
 *
 * 备注承载"标题装不下"的上下文：验收标准、卡点、参考资料。
 * 允许清空（传空串即删除备注）—— 界面上不用区分"编辑"与"删除备注"两个动作。
 */
export async function updateTaskDetails(
  deps: TaskDeps,
  task: Task,
  draft: { title?: string | undefined; note?: string | undefined },
  now: number,
): Promise<Task> {
  const title = draft.title?.trim();
  if (title !== undefined && title.length === 0)
    throw new Error("任务标题不能为空");
  const note = draft.note?.trim();

  return deps.tasks.put(
    {
      ...task,
      ...(title !== undefined ? { title } : {}),
      ...(note !== undefined && note.length > 0
        ? { note }
        : { note: undefined }),
      updatedAt: now,
    },
    now,
  );
}

/**
 * 软删除任务（含全部后代）
 *
 * 后代一起进回收站：只删父任务会留下"幽灵子任务"——
 * 树里看不到入口，却仍然占着统计数字。
 */
export async function deleteTask(
  deps: TaskDeps,
  planId: string,
  taskId: string,
  now: number,
): Promise<number> {
  const all = await deps.tasks.byPlan(planId);
  const ids = [taskId, ...descendantIds(all, taskId)];
  for (const id of ids) {
    const task = all.find((candidate) => candidate.id === id);
    if (task !== undefined) await deps.tasks.softDelete(id, now);
  }
  return ids.length;
}
