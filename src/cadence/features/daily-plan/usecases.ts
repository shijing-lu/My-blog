/**
 * 每日计划用例层
 * 依据：docs/07-每日计划模块.md
 * ---------------------------------------------------------------------------
 * 职责边界（重要）：本模块只操作 dailyPlans **这一张表** ——
 * features 层禁止跨切片引用（eslint: cadence/layer-boundaries），
 * 因此与任务/待办/专注的联动由**调用方**（pages 与 widgets）组合：
 *
 *   - 勾选完成 → setItemDone +（kind='task' 时）setTaskStatus
 *   - 推上看板 → createTodo + linkItemToTodo
 *   - 开始专注 → startSession（note = 条目标题，关联 planId/taskId）
 *
 * 每个调用方组合的顺序与规则必须遵循 docs/07 §3 —— 单元测试里有组合范本。
 * 全部方法接收 now —— 与全站纪律一致。
 */

import type {
  DailyItemKind,
  DailyPlan,
  DailyPlanItem,
} from "@/cadence/entities/daily-plan";
import {
  dailyPlanIdOf,
  extractDuration,
  newItemId,
} from "@/cadence/entities/daily-plan";
import { NOT_DELETED } from "@/cadence/shared/model/entity";
import type { CadenceDatabase } from "@/cadence/data/db/database";

export interface DailyPlanDeps {
  /** 直接持表：日计划是聚合根，整体读写，不需要通用 repo 的逐条语义 */
  database: CadenceDatabase;
}

export function createDailyPlanDeps(database: CadenceDatabase): DailyPlanDeps {
  return { database };
}

/* ── 读取 ── */

/** 取某天的计划；不存在返回 undefined（"还没有计划"是合法状态，不静默建空档） */
export async function getDailyPlan(
  deps: DailyPlanDeps,
  dateKey: string,
): Promise<DailyPlan | undefined> {
  return deps.database.dailyPlans.get(dailyPlanIdOf(dateKey));
}

/** 取某天的计划；不存在则创建空档（幂等） */
export async function getOrCreateDailyPlan(
  deps: DailyPlanDeps,
  dateKey: string,
  now: number,
): Promise<DailyPlan> {
  const id = dailyPlanIdOf(dateKey);
  const existing = await deps.database.dailyPlans.get(id);
  if (existing !== undefined) return existing;

  const plan: DailyPlan = {
    id,
    dateKey,
    items: [],
    createdAt: now,
    updatedAt: now,
  };
  await deps.database.dailyPlans.put(plan);
  return plan;
}

/** 引用的任务是否存在且未删除（供调用方在添加 kind='task' 条目前校验） */
export async function taskIsUsable(
  database: CadenceDatabase,
  taskId: string,
): Promise<boolean> {
  const task = await database.tasks.get(taskId);
  return task !== undefined && task.deletedAt === NOT_DELETED;
}

/* ── 条目操作（纯本表） ── */

export interface ItemDraft {
  kind: DailyItemKind;
  /** 引用源 id（task / todo）；free 省略 */
  refId?: string | undefined;
  title: string;
  note?: string | undefined;
  estimateMinutes?: number | undefined;
}

const MAX_ITEMS = 50;

function toItem(draft: ItemDraft, now: number): DailyPlanItem {
  const trimmed = draft.title.trim();
  if (trimmed.length === 0) throw new Error("计划项内容不能为空");

  // 精简规则（docs/07 §4.2）：自然语言条目里的时长描述（"一个半小时""大概 45 分钟"）
  // 提炼进 estimateMinutes，标题只留事项本身。仅对 free 条目生效 ——
  // task/todo 条目的标题来自源实体，改写会与源对不上。
  let title = trimmed;
  let duration = draft.estimateMinutes;
  if (draft.kind === "free") {
    const extracted = extractDuration(trimmed);
    title = extracted.title;
    duration = duration ?? extracted.estimateMinutes;
  }

  return {
    id: newItemId(now),
    kind: draft.kind,
    ...(draft.refId !== undefined ? { refId: draft.refId } : {}),
    title,
    ...(draft.note !== undefined && draft.note.length > 0
      ? { note: draft.note }
      : {}),
    ...(duration !== undefined ? { estimateMinutes: duration } : {}),
    done: false,
  };
}

/** 追加一条 */
export async function addItem(
  deps: DailyPlanDeps,
  dateKey: string,
  draft: ItemDraft,
  now: number,
): Promise<DailyPlan> {
  const plan = await getOrCreateDailyPlan(deps, dateKey, now);
  if (plan.items.length >= MAX_ITEMS)
    throw new Error("一天的计划太满了（上限 50 项）——先把最重要的事排进来");

  const next: DailyPlan = {
    ...plan,
    items: [...plan.items, toItem(draft, now)],
    updatedAt: now,
  };
  await deps.database.dailyPlans.put(next);
  return next;
}

/** 整体替换当天的清单（AI 的"制定今天的计划"） */
export async function replaceItems(
  deps: DailyPlanDeps,
  dateKey: string,
  drafts: ItemDraft[],
  now: number,
): Promise<DailyPlan> {
  if (drafts.length === 0) throw new Error("至少要有一项");
  if (drafts.length > MAX_ITEMS)
    throw new Error("一天的计划太满了（上限 50 项）");

  const plan = await getOrCreateDailyPlan(deps, dateKey, now);
  const next: DailyPlan = {
    ...plan,
    items: drafts.map((draft) => toItem(draft, now)),
    updatedAt: now,
  };
  await deps.database.dailyPlans.put(next);
  return next;
}

/** 删除一条（日项本体删除，不影响引用的任务/待办 —— 删除语义跟随各自的模块） */
export async function removeItem(
  deps: DailyPlanDeps,
  dateKey: string,
  itemId: string,
  now: number,
): Promise<void> {
  const plan = await getDailyPlan(deps, dateKey);
  if (plan === undefined) return;
  await deps.database.dailyPlans.put({
    ...plan,
    items: plan.items.filter((item) => item.id !== itemId),
    updatedAt: now,
  });
}

/** 勾选/取消一条（纯本表；与任务的联动由调用方按 docs/07 §3.2 组合） */
export async function setItemDone(
  deps: DailyPlanDeps,
  dateKey: string,
  itemId: string,
  done: boolean,
  now: number,
): Promise<DailyPlan> {
  const plan = await getDailyPlan(deps, dateKey);
  if (plan === undefined) throw new Error("当天的计划不存在");
  if (!plan.items.some((item) => item.id === itemId))
    throw new Error("这条计划项不存在（可能已被删除）");

  const items = plan.items.map((item) =>
    item.id === itemId ? { ...item, done } : item,
  );
  const next: DailyPlan = { ...plan, items, updatedAt: now };
  await deps.database.dailyPlans.put(next);
  return next;
}

/** 把一条日项标记为"引用某待办"（推上看板后由调用方写入；todo 的创建在调用方） */
export async function linkItemToTodo(
  deps: DailyPlanDeps,
  dateKey: string,
  itemId: string,
  todoId: string,
  now: number,
): Promise<DailyPlan> {
  const plan = await getDailyPlan(deps, dateKey);
  if (plan === undefined) throw new Error("当天的计划不存在");

  const items = plan.items.map((item) =>
    item.id === itemId
      ? { ...item, kind: "todo" as const, refId: todoId }
      : item,
  );
  const next: DailyPlan = { ...plan, items, updatedAt: now };
  await deps.database.dailyPlans.put(next);
  return next;
}
