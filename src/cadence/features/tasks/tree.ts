/**
 * 任务树纯逻辑
 * ---------------------------------------------------------------------------
 * 层级上限 3 层（01-需求文档 FR-PLAN-04：计划 → 任务 → 子任务）。
 *
 * 为什么不用 parentId 递归查询数据库：
 *   一次 `byPlan(planId)` 已取回该计划的全部任务（几十条量级），
 *   在内存里组树是 O(n)，而按 parentId 逐层查询是 O(层级) 次IndexedDB 往返。
 *   树是**视图概念**，不是存储结构 —— 存储只存 parentId。
 */

import type { Task, TaskId, TaskStatus } from "@/cadence/entities/task";

/** 层级上限：计划 → 任务 → 子任务。更深的需求应促使用户拆计划而不是拆任务 */
export const MAX_TREE_DEPTH = 3;

export interface TaskNode {
  task: Task;
  children: TaskNode[];
  /** 子树内完成的任务数（含自身；直接任务才参与进度统计） */
  doneCount: number;
  totalCount: number;
}

/**
 * 把平铺的任务数组组装成树
 *
 * 孤儿任务（parentId 指向不存在的任务）不丢弃，而是提升为顶层 ——
 * 引用完整性检查拦截不了"导入后父任务被单独删除"这类运行期悬空，
 * 此时宁可显示出来让用户看到，也不能静默吞掉数据。
 */
export function buildTree(tasks: readonly Task[]): TaskNode[] {
  const byId = new Map<TaskId, TaskNode>();
  for (const task of tasks)
    byId.set(task.id, { task, children: [], doneCount: 0, totalCount: 0 });

  const roots: TaskNode[] = [];

  for (const node of byId.values()) {
    const parentId = node.task.parentId;
    const parent = parentId !== undefined ? byId.get(parentId) : undefined;
    if (parent === undefined || parent === node) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  // 自底向上汇总完成数，并把子任务按 order 排序
  const summarize = (node: TaskNode): void => {
    node.children.sort((a, b) => a.task.order - b.task.order);
    let done = node.task.status === "done" ? 1 : 0;
    let total = 1;
    for (const child of node.children) {
      summarize(child);
      done += child.doneCount;
      total += child.totalCount;
    }
    node.doneCount = done;
    node.totalCount = total;
  };
  for (const root of roots) summarize(root);

  roots.sort((a, b) => a.task.order - b.task.order);
  return roots;
}

/**
 * 手动排序值：取相邻两项的中点。
 *
 * 为什么用浮点中点而不是"整段重排"：
 *   插入一项只写一条记录，其余任务纹丝不动。
 *   浮点精度极限约在 2^53 次插分之后，届时做一次全量归位即可
 *   （M4 的拖拽排序 UI 会调用 orderRebalance，这里先留出语义）。
 */
export function orderBetween(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before === undefined && after === undefined) return 10;
  if (before === undefined) return after! / 2;
  if (after === undefined) return before + 10;
  return (before + after) / 2;
}

/** 新任务的默认 order：排在同级末尾 */
export function orderAtEnd(siblings: readonly Task[]): number {
  let max = 0;
  for (const task of siblings) {
    if (task.order > max) max = task.order;
  }
  return max === 0 ? 10 : max + 10;
}

/** 深度优先平铺（保序），用于"展开全部/收起全部"与统计 */
export function flattenTree(nodes: readonly TaskNode[]): TaskNode[] {
  const result: TaskNode[] = [];
  const walk = (list: readonly TaskNode[]) => {
    for (const node of list) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

/**
 * 判断某深度能否再往下建一层（层级上限 3 层）
 *
 * 只依赖深度、不依赖具体节点，所以签名就是"祖先链"——
 * 传具体节点进来却不用它，反而会让人误以为判断与节点内容有关。
 */
export function canHaveChildren(ancestors: readonly TaskNode[] = []): boolean {
  // 目标层 = ancestors.length + 1；上限内才可继续
  return ancestors.length + 1 < MAX_TREE_DEPTH;
}

/** 某状态在树里的任务数 */
export function countByStatus(
  nodes: readonly TaskNode[],
): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    todo: 0,
    doing: 0,
    done: 0,
    blocked: 0,
  };
  for (const node of flattenTree(nodes)) counts[node.task.status] += 1;
  return counts;
}

/** 某任务的全部分代 id（软删除父任务时级联用；不含自身） */
export function descendantIds(
  tasks: readonly Task[],
  rootId: TaskId,
): TaskId[] {
  const result: TaskId[] = [];
  const walk = (parentId: TaskId) => {
    for (const task of tasks) {
      if (task.parentId === parentId) {
        result.push(task.id);
        walk(task.id);
      }
    }
  };
  walk(rootId);
  return result;
}
