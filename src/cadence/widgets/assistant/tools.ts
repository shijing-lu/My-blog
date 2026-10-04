/**
 * AI 助手 · 能力注册表
 * ---------------------------------------------------------------------------
 * 覆盖原则：用户在界面上能手动完成的每一个操作，这里都有同名工具。
 * 工具只做"参数 → 现有用例层调用 → 结果描述"，不包含任何新业务规则；
 * 查找实体用标题包含匹配，命中 0 个或多个都报错反问，绝不猜。
 */

import { z } from "zod";

import type { Countdown, CountdownUnit } from "@/cadence/entities/countdown";
import type { Plan } from "@/cadence/entities/plan";
import type { Task } from "@/cadence/entities/task";
import type { Todo } from "@/cadence/entities/todo";
import { sessionDurationMs } from "@/cadence/entities/session";
import { isPlanStatus, type PlanStatus } from "@/cadence/entities/plan";
import {
  describeAmount,
  formatRemaining,
  isPaused,
  remainingMsOf,
  targetAtOfDateTime,
  UNIT_MS,
} from "@/cadence/entities/countdown";
import { parseOneClock } from "@/cadence/entities/schedule";
import { clampCoordinate } from "@/cadence/entities/todo";
import { deriveSlots, slotOf } from "@/cadence/entities/review";
import { db } from "@/cadence/data/db/database";
import {
  changePlanStatus,
  createPlan,
  createPlanDeps,
  deletePlan,
  updatePlanDetails,
} from "@/cadence/features/plans";
import {
  createSubtask,
  createTask,
  createTaskDeps,
  deleteTask,
  setTaskStatus,
  updateTaskDetails,
} from "@/cadence/features/tasks";
import {
  createTodo,
  createTodoDeps,
  deleteTodo,
  moveTodo,
  setTodoStatus,
} from "@/cadence/features/todos";
import {
  createSessionDeps,
  startSession,
  stopSession,
} from "@/cadence/features/execute";
import {
  createReviewDeps,
  createSchedule,
  upsertEntry,
} from "@/cadence/features/review";
import {
  addItem,
  createDailyPlanDeps,
  getDailyPlan,
  linkItemToTodo,
  removeItem,
  replaceItems,
  setItemDone,
} from "@/cadence/features/daily-plan";
import {
  createEventsFromText,
  createScheduleDeps,
  listDayEvents,
  moveEvent,
  removeEvent,
  resizeEvent,
  setEventDone,
  updateEventDetails,
} from "@/cadence/features/schedule";
import {
  adjustCountdown,
  createCountdown,
  createCountdownDeps,
  listCountdowns,
  pauseCountdown,
  removeCountdown,
  resumeCountdown,
} from "@/cadence/features/countdown";
import {
  dateKeyOf,
  endOfDayMs,
  localTzOffsetMinutes,
  startOfDayMs,
} from "@/cadence/shared/db/time";
import { isDeleted, NOT_DELETED } from "@/cadence/shared/model/entity";
import { useAppearanceStore } from "@/cadence/shared/store/appearance-store";

import type { AssistantTool } from "./types";

/* ── 查找辅助：全部"包含匹配 + 唯一性检查"，不猜 ── */

function matchUnique<T extends { id: string }>(
  label: string,
  query: string,
  items: readonly T[],
  /** 展示/匹配用的字段（默认 title；倒计时这类用 name 的实体传取值器） */
  textOf: (item: T) => string = (item) =>
    (item as unknown as { title: string }).title,
): T {
  const q = query.trim();
  const hits = items.filter((item) => textOf(item).includes(q));
  if (hits.length === 0) throw new Error(`没有找到${label}包含「${q}」的记录`);
  if (hits.length > 1) {
    const names = hits
      .slice(0, 5)
      .map((item) => `「${textOf(item)}」`)
      .join("、");
    throw new Error(
      `有 ${hits.length} 个${label}都包含「${q}」：${names}。请说得更具体一些`,
    );
  }
  return hits[0]!;
}

async function findPlan(title: string): Promise<Plan> {
  const plans = (
    await db.plans.where("deletedAt").equals(NOT_DELETED).toArray()
  ).filter((plan) => !isDeleted(plan));
  return matchUnique("计划", title, plans);
}

async function findTask(title: string): Promise<Task> {
  const tasks = (
    await db.tasks.where("deletedAt").equals(NOT_DELETED).toArray()
  ).filter((task) => !isDeleted(task));
  return matchUnique("任务", title, tasks);
}

async function findTodo(title: string): Promise<Todo> {
  const todos = (
    await db.todos.where("deletedAt").equals(NOT_DELETED).toArray()
  ).filter((todo) => !isDeleted(todo));
  return matchUnique("待办", title, todos);
}

/** 象限词 → 归一化坐标（业务坐标 y 向上为正，取象限中心） */
const QUADRANT_POINTS: Record<string, { x: number; y: number }> = {
  重要且紧急: { x: 75, y: 75 },
  重要不紧急: { x: 25, y: 75 },
  紧急不重要: { x: 75, y: 25 },
  不重要不紧急: { x: 25, y: 25 },
};

function pointOfQuadrant(quadrant: string | undefined): {
  x: number;
  y: number;
} {
  if (quadrant !== undefined) {
    const hit = QUADRANT_POINTS[quadrant];
    if (hit !== undefined) return hit;
  }
  // 未指定象限 → 默认"重要不紧急"（待办的常规入口），clamp 保证合法
  return clampCoordinate({ x: 25, y: 75 });
}

const STATUS_WORDS: Record<string, PlanStatus> = {
  暂停: "paused",
  继续: "active",
  恢复: "active",
  完成: "completed",
  标记完成: "completed",
  归档: "archived",
};

/* ── 注册表 ── */

export const TOOLS: readonly AssistantTool[] = [
  /* 计划 */
  {
    name: "plan_create",
    description:
      '新建一个计划。用户说"制定计划 / 创建计划 / 建一个计划"时使用。',
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("计划标题"),
      description: z.string().optional().describe("计划说明（可选）"),
    }),
    execute: async (args, ctx) => {
      const plan = await createPlan(createPlanDeps(db), args, ctx.now);
      return `已创建计划「${plan.title}」`;
    },
  },
  {
    name: "plan_update",
    description:
      '修改已有计划的标题或说明。用户说"把 X 计划的说明改成…"时使用。',
    destructive: false,
    params: z.object({
      plan: z.string().min(1).describe("计划标题（支持部分匹配）"),
      title: z.string().optional().describe("新标题"),
      description: z.string().optional().describe("新说明；传空串表示清空"),
    }),
    execute: async (args, ctx) => {
      const plan = await findPlan(args.plan);
      await updatePlanDetails(
        createPlanDeps(db),
        plan.id,
        {
          title: args.title?.trim() || plan.title,
          description:
            args.description !== undefined
              ? args.description.trim() || undefined
              : plan.description,
        },
        ctx.now,
      );
      return `已更新计划「${plan.title}」`;
    },
  },
  {
    name: "plan_set_status",
    description: "改变计划状态：暂停 / 继续（恢复）/ 完成 / 归档。",
    destructive: false,
    params: z.object({
      plan: z.string().min(1).describe("计划标题（支持部分匹配）"),
      status: z.string().min(1).describe("目标状态：暂停 | 继续 | 完成 | 归档"),
    }),
    execute: async (args, ctx) => {
      const status =
        STATUS_WORDS[args.status] ??
        (isPlanStatus(args.status) ? (args.status as PlanStatus) : undefined);
      if (status === undefined)
        throw new Error(
          `不认识的状态「${args.status}」，可用：暂停 / 继续 / 完成 / 归档`,
        );
      const plan = await findPlan(args.plan);
      await changePlanStatus(createPlanDeps(db), plan.id, status, ctx.now);
      return `计划「${plan.title}」已${STATUS_WORDS[args.status] ?? args.status}`;
    },
  },
  {
    name: "plan_delete",
    description:
      "删除计划（连带其下任务，进入回收站）。破坏性操作，必须经用户确认。",
    destructive: true,
    params: z.object({
      plan: z.string().min(1).describe("计划标题（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const plan = await findPlan(args.plan);
      const count = await deletePlan(createPlanDeps(db), plan.id, ctx.now);
      return `已删除计划「${plan.title}」${count > 0 ? `（连带 ${count} 个任务）` : ""}，30 天内可在设置·回收站恢复`;
    },
  },

  /* 任务 */
  {
    name: "task_create",
    description: '给某个计划添加一个任务。用户说"给 X 计划加任务 Y"时使用。',
    destructive: false,
    params: z.object({
      plan: z.string().min(1).describe("所属计划标题（支持部分匹配）"),
      title: z.string().min(1).describe("任务标题"),
      note: z.string().optional().describe("任务备注（可选）"),
    }),
    execute: async (args, ctx) => {
      const plan = await findPlan(args.plan);
      const task = await createTask(createTaskDeps(db), plan.id, args, ctx.now);
      return `已在计划「${plan.title}」下创建任务「${task.title}」`;
    },
  },
  {
    name: "task_create_sub",
    description: "给某个任务添加一个子任务（最多 3 层）。",
    destructive: false,
    params: z.object({
      parent: z.string().min(1).describe("父任务标题（支持部分匹配）"),
      title: z.string().min(1).describe("子任务标题"),
    }),
    execute: async (args, ctx) => {
      const parent = await findTask(args.parent);
      // createSubtask 需要 TaskNode（含子树信息）；这里只关心层级判断，
      // 手造一个叶子节点（无子树、计数按自身）即可
      const parentNode = {
        task: parent,
        children: [],
        doneCount: parent.status === "done" ? 1 : 0,
        totalCount: 1,
      };
      const child = await createSubtask(
        createTaskDeps(db),
        parentNode,
        [],
        { title: args.title },
        ctx.now,
      );
      return `已在「${parent.title}」下创建子任务「${child.title}」`;
    },
  },
  {
    name: "task_set_status",
    description:
      '完成任务或重新打开任务。用户说"完成任务 X / 把 X 重新打开"时使用。',
    destructive: false,
    params: z.object({
      task: z.string().min(1).describe("任务标题（支持部分匹配）"),
      done: z.boolean().describe("true = 完成，false = 重新打开"),
    }),
    execute: async (args, ctx) => {
      const task = await findTask(args.task);
      await setTaskStatus(
        createTaskDeps(db),
        task,
        args.done ? "done" : "todo",
        ctx.now,
      );
      return args.done
        ? `任务「${task.title}」已完成`
        : `任务「${task.title}」已重新打开`;
    },
  },
  {
    name: "task_note",
    description: "给任务写备注，或清空备注。",
    destructive: false,
    params: z.object({
      task: z.string().min(1).describe("任务标题（支持部分匹配）"),
      note: z.string().min(1).describe("备注内容；传空串表示清空"),
    }),
    execute: async (args, ctx) => {
      const task = await findTask(args.task);
      await updateTaskDetails(
        createTaskDeps(db),
        task,
        { note: args.note },
        ctx.now,
      );
      return args.note.trim().length === 0
        ? `已清空任务「${task.title}」的备注`
        : `已为任务「${task.title}」写入备注`;
    },
  },
  {
    name: "task_delete",
    description:
      "删除任务（连带子任务，进入回收站）。破坏性操作，必须经用户确认。",
    destructive: true,
    params: z.object({
      task: z.string().min(1).describe("任务标题（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const task = await findTask(args.task);
      await deleteTask(createTaskDeps(db), task.planId, task.id, ctx.now);
      return `已删除任务「${task.title}」`;
    },
  },

  /* 待办 */
  {
    name: "todo_create",
    description:
      "记一条待办，可指定象限（重要且紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急）。",
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("待办内容"),
      quadrant: z.string().optional().describe("象限名称（可选）"),
    }),
    execute: async (args, ctx) => {
      const todo = await createTodo(
        createTodoDeps(db),
        { title: args.title, coordinate: pointOfQuadrant(args.quadrant) },
        ctx.now,
      );
      const where = args.quadrant !== undefined ? `（${args.quadrant}）` : "";
      return `已记下待办「${todo.title}」${where}`;
    },
  },
  {
    name: "todo_move",
    description: "把待办移动到另一个象限。",
    destructive: false,
    params: z.object({
      todo: z.string().min(1).describe("待办内容（支持部分匹配）"),
      quadrant: z.string().min(1).describe("目标象限"),
    }),
    execute: async (args, ctx) => {
      const todo = await findTodo(args.todo);
      const point = QUADRANT_POINTS[args.quadrant];
      if (point === undefined)
        throw new Error(`不认识的象限「${args.quadrant}」`);
      await moveTodo(createTodoDeps(db), todo, clampCoordinate(point), ctx.now);
      return `已把「${todo.title}」移到${args.quadrant}`;
    },
  },
  {
    name: "todo_set_status",
    description: "完成或重开一条待办。",
    destructive: false,
    params: z.object({
      todo: z.string().min(1).describe("待办内容（支持部分匹配）"),
      done: z.boolean(),
    }),
    execute: async (args, ctx) => {
      const todo = await findTodo(args.todo);
      await setTodoStatus(
        createTodoDeps(db),
        todo,
        args.done ? "done" : "open",
        ctx.now,
      );
      return args.done
        ? `待办「${todo.title}」已完成`
        : `待办「${todo.title}」已重开`;
    },
  },
  {
    name: "todo_delete",
    description: "删除待办（进入回收站）。破坏性操作，必须经用户确认。",
    destructive: true,
    params: z.object({
      todo: z.string().min(1).describe("待办内容（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const todo = await findTodo(args.todo);
      await deleteTodo(createTodoDeps(db), todo.id, ctx.now);
      return `已删除待办「${todo.title}」`;
    },
  },

  /* 专注 */
  {
    name: "focus_start",
    description: "开始一段专注（同一时间只能有一段）。",
    destructive: false,
    params: z.object({
      note: z.string().optional().describe("在做什么（可选）"),
    }),
    execute: async (args, ctx) => {
      await startSession(createSessionDeps(db), { note: args.note }, ctx.now);
      return args.note !== undefined
        ? `专注已开始（${args.note}），计时走起`
        : "专注已开始，计时走起";
    },
  },
  {
    name: "focus_stop",
    description: "结束当前进行中的专注。",
    destructive: false,
    params: z.object({}),
    execute: async (_, ctx) => {
      const deps = createSessionDeps(db);
      const tz = localTzOffsetMinutes();
      const key = dateKeyOf(ctx.now, tz);
      const list = await deps.sessions.inRange(
        startOfDayMs(key, tz) - 2 * 86_400_000,
        endOfDayMs(key, tz) + 86_400_000,
      );
      const active = list.find((session) => session.endedAt === undefined);
      if (active === undefined) throw new Error("当前没有进行中的专注");
      await stopSession(deps, active, ctx.now);
      return `专注已结束。告诉我这段时间做了什么，我帮你写进复盘（或到执行页查看弹窗）`;
    },
  },

  /* 复盘 */
  {
    name: "review_schedule_create",
    description:
      '创建复盘周期（如"每 4 小时复盘一次"）。用户说"建一个复盘周期"时使用。',
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("周期名称"),
      intervalHours: z
        .number()
        .positive()
        .max(24)
        .optional()
        .describe("间隔小时数，默认 8"),
      prompt: z.string().optional().describe("引导语（可选）"),
    }),
    execute: async (args, ctx) => {
      const schedule = await createSchedule(
        createReviewDeps(db),
        {
          title: args.title,
          intervalHours: args.intervalHours ?? 8,
          anchorOffsetMs: 9 * 3_600_000,
          prompt: args.prompt,
        },
        ctx.now,
      );
      return `复盘周期「${schedule.title}」已创建：每 ${schedule.intervalHours} 小时一格`;
    },
  },
  {
    name: "review_entry_write",
    description: "给当前时段写一条复盘。",
    destructive: false,
    params: z.object({
      content: z.string().min(1).describe("复盘内容"),
      mood: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("心情 1–5（可选）"),
    }),
    execute: async (args, ctx) => {
      const deps = createReviewDeps(db);
      const schedules = await deps.schedules.list();
      const schedule = schedules
        .filter((item) => item.enabled)
        .sort((a, b) => a.order - b.order)[0];
      if (schedule === undefined)
        throw new Error('还没有复盘周期。先说"建一个复盘周期"');

      const tz = localTzOffsetMinutes();
      const slots = deriveSlots(schedule, dateKeyOf(ctx.now, tz), tz);
      const slot = slotOf(slots, ctx.now);
      if (slot === undefined) throw new Error("当前时间不在任何复盘格子里");

      await upsertEntry(
        deps,
        schedule,
        slot.start,
        slot.dateKey,
        args,
        ctx.now,
      );
      return `已写入「${schedule.title}」当前时段的复盘`;
    },
  },

  /* 每日计划（docs/07）：与 plan_create 的边界 —— 「今天的计划」归这里，「计划」归计划树 */
  {
    name: "daily_plan_set",
    description:
      '制定今天的计划（整体替换当天清单）。用户说"制定今天的计划 / 排一下今天要做的事"且给出多项内容时使用。注意：这不是创建长期计划（plan_create），也不是待办。把每个事项提炼成简短标题（如"背单词"），时长/限定词描述会被系统单独识别，不必写进标题。',
    destructive: false,
    params: z.object({
      items: z
        .array(z.string().min(1))
        .min(1)
        .max(50)
        .describe("今天的计划项列表"),
    }),
    execute: async (args, ctx) => {
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const plan = await replaceItems(
        deps,
        dateKey,
        args.items.map((title: string) => ({ kind: "free" as const, title })),
        ctx.now,
      );
      return `今天的计划已排好，共 ${plan.items.length} 项（在总览页可见）`;
    },
  },
  {
    name: "daily_plan_add",
    description: '往今天的计划里追加一项。用户说"今天再加一件事：X"时使用。',
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("事项内容"),
      estimateMinutes: z
        .number()
        .positive()
        .optional()
        .describe("预计专注分钟数（可选）"),
    }),
    execute: async (args, ctx) => {
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      await addItem(
        deps,
        dateKey,
        {
          kind: "free",
          title: args.title,
          estimateMinutes: args.estimateMinutes,
        },
        ctx.now,
      );
      return `已加入今天的计划：「${args.title}」`;
    },
  },
  {
    name: "daily_plan_add_task",
    description:
      '把某个已有任务排进今天的计划。用户说"今天做任务 X / 把 X 排到今天"时使用。',
    destructive: false,
    params: z.object({
      task: z.string().min(1).describe("任务标题（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const task = await findTask(args.task);
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      await addItem(
        deps,
        dateKey,
        { kind: "task", refId: task.id, title: task.title },
        ctx.now,
      );
      return `任务「${task.title}」已排入今天的计划`;
    },
  },
  {
    name: "daily_plan_remove",
    description: "从今天的计划里移除一项（不影响任务/待办本体）。",
    destructive: true,
    params: z.object({
      title: z.string().min(1).describe("计划项内容（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const plan = await getDailyPlanOf(deps, dateKey);
      const item = matchDailyItem(plan, args.title);
      await removeItem(deps, dateKey, item.id, ctx.now);
      return `已从今天的计划移除「${item.title}」`;
    },
  },
  {
    name: "daily_plan_done",
    description: "勾选完成今天计划里的一项；若它引用任务，任务会一并完成。",
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("计划项内容（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const plan = await getDailyPlanOf(deps, dateKey);
      const item = matchDailyItem(plan, args.title);
      await setItemDone(deps, dateKey, item.id, true, ctx.now);

      // 联动组合（docs/07 §3.2）：kind='task' → 引用任务一并完成（正向单向）
      let suffix = "";
      if (item.kind === "task" && item.refId !== undefined) {
        const task = await db.tasks.get(item.refId);
        if (task !== undefined && task.status !== "done") {
          await setTaskStatus(createTaskDeps(db), task, "done", ctx.now);
          suffix = "，关联任务同步完成";
        }
      }
      return `「${item.title}」已完成${suffix}`;
    },
  },
  {
    name: "daily_plan_report",
    description: '播报今天的计划清单与完成进度。用户问"今天计划是什么"时使用。',
    destructive: false,
    params: z.object({}),
    execute: async (_, ctx) => {
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const plan = await getDailyPlanOf(deps, dateKey);
      const done = plan.items.filter((item) => item.done);
      const rest = plan.items.filter((item) => !item.done);
      if (plan.items.length === 0)
        return "今天的计划还是空的。告诉我今天要做什么，我来排。";
      const restText = rest.map((item) => item.title).join("、");
      return `今天共 ${plan.items.length} 项，已完成 ${done.length} 项。剩余：${restText || "无"}`;
    },
  },
  {
    name: "daily_plan_promote",
    description: "把今天计划里的一项推上 XY 待办看板（可指定象限）。",
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("计划项内容（支持部分匹配）"),
      quadrant: z.string().optional().describe("目标象限（可选）"),
    }),
    execute: async (args, ctx) => {
      const point =
        args.quadrant !== undefined
          ? QUADRANT_POINTS[args.quadrant]
          : undefined;
      if (args.quadrant !== undefined && point === undefined) {
        throw new Error(`不认识的象限「${args.quadrant}」`);
      }
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const plan = await getDailyPlanOf(deps, dateKey);
      const item = matchDailyItem(plan, args.title);

      // 联动组合（docs/07 §3.3）：createTodo + linkItemToTodo
      const coordinate = clampCoordinate(point ?? { x: 25, y: 75 });
      const todo = await createTodo(
        createTodoDeps(db),
        { title: item.title, coordinate },
        ctx.now,
      );
      await linkItemToTodo(deps, dateKey, item.id, todo.id, ctx.now);
      return `「${item.title}」已推上待办看板${args.quadrant !== undefined ? `（${args.quadrant}）` : ""}`;
    },
  },
  {
    name: "daily_plan_focus",
    description: "以今天计划里的某一项开始专注（执行记录自动关联所属计划）。",
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("计划项内容（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const deps = createDailyPlanDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const plan = await getDailyPlanOf(deps, dateKey);
      const item = matchDailyItem(plan, args.title);

      // 联动组合（docs/07 §3.4）：引用任务 → 会话挂 planId/taskId，统计归对账本
      let planId: string | undefined;
      let taskId: string | undefined;
      if (item.kind === "task" && item.refId !== undefined) {
        const task = await db.tasks.get(item.refId);
        if (task !== undefined && task.deletedAt === NOT_DELETED) {
          taskId = task.id;
          planId = task.planId;
        }
      }
      await startSession(
        createSessionDeps(db),
        { note: item.title, planId, taskId },
        ctx.now,
      );
      return `已围绕「${item.title}」开始专注`;
    },
  },

  /* ── 日程（24 小时面板，docs/08 §AI：手动操作 ↔ 工具一一对应） ── */
  {
    name: "schedule_create",
    description:
      '按一句话创建一天的多条日程（24 小时面板）。每项必须带起止时间，如"6点到7点背单词，7点半到9点复习数学"。与 daily_plan_set 的分界：带具体时刻段落进日程面板，不带时刻的清单进今日计划。',
    destructive: false,
    params: z.object({
      text: z
        .string()
        .min(1)
        .describe(
          "完整原句，含全部起止时间与事项名。系统自行解析，不要改写时刻",
        ),
    }),
    execute: async (args, ctx) => {
      const deps = createScheduleDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const report = await createEventsFromText(
        deps,
        dateKey,
        args.text,
        ctx.now,
      );
      const parts = report.created.map(
        (event) =>
          `「${event.title}」${clockLabelOf(event.startMin)}–${clockLabelOf(event.endMin)}`,
      );
      if (report.rejected.length > 0) {
        const rejected = report.rejected
          .map((item) => `「${item.title}」${item.reason}`)
          .join("；");
        return `已创建 ${report.created.length} 条：${parts.join("、")}。另有被拒的：${rejected}（在日程页可见）`;
      }
      return `已创建 ${report.created.length} 条日程：${parts.join("、")}（在日程页可见）`;
    },
  },
  {
    name: "schedule_rename",
    description: "修改日程的标题或备注。",
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("现有日程标题（支持部分匹配）"),
      newTitle: z.string().optional().describe("新标题"),
      note: z.string().optional().describe("新备注；空串表示清除备注"),
    }),
    execute: async (args, ctx) => {
      if (args.newTitle === undefined && args.note === undefined) {
        throw new Error("要改标题还是备注？告诉我改成什么");
      }
      const deps = createScheduleDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const event = await findEventOf(dateKey, args.title);
      await updateEventDetails(
        deps,
        dateKey,
        event.id,
        {
          ...(args.newTitle !== undefined ? { title: args.newTitle } : {}),
          ...(args.note !== undefined ? { note: args.note } : {}),
        },
        ctx.now,
      );
      return "日程已更新";
    },
  },
  {
    name: "schedule_move",
    description:
      '把日程挪到新的开始时间（时长保持不变）。说"把背单词挪到8点半"。',
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("现有日程标题（支持部分匹配）"),
      time: z.string().min(1).describe('新开始时间，如"8点半"、"14:30"'),
    }),
    execute: async (args, ctx) => {
      const startMin = parseOneClock(args.time);
      if (startMin === undefined)
        throw new Error(
          `没能理解时刻「${args.time}」，请用"8点半"或"14:30"这类写法`,
        );
      const deps = createScheduleDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const event = await findEventOf(dateKey, args.title);
      await moveEvent(deps, dateKey, event.id, startMin, ctx.now);
      return `「${event.title}」已挪到 ${clockLabelOf(startMin)}–${clockLabelOf(startMin + (event.endMin - event.startMin))}`;
    },
  },
  {
    name: "schedule_resize",
    description:
      '调整日程的结束时间或时长。说"背单词改到9点结束"或"把站会延长15分钟"。',
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("现有日程标题（支持部分匹配）"),
      endTime: z.string().optional().describe('新结束时间，如"9点"'),
      durationMinutes: z
        .number()
        .int()
        .optional()
        .describe("或直接给新时长（分钟）"),
    }),
    execute: async (args, ctx) => {
      const deps = createScheduleDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const event = await findEventOf(dateKey, args.title);

      let endMin: number;
      if (args.endTime !== undefined) {
        const parsed = parseOneClock(args.endTime);
        if (parsed === undefined) {
          throw new Error(
            `没能理解时刻「${args.endTime}」，请用"9点"或"14:30"这类写法`,
          );
        }
        endMin = parsed;
      } else if (args.durationMinutes !== undefined) {
        endMin = event.startMin + args.durationMinutes;
      } else {
        throw new Error("要改到几点结束，还是改成多长（分钟）？");
      }

      await resizeEvent(deps, dateKey, event.id, endMin, ctx.now);
      return `「${event.title}」已调整为 ${clockLabelOf(event.startMin)}–${clockLabelOf(endMin)}`;
    },
  },
  {
    name: "schedule_complete",
    description:
      "标记日程完成（或撤销完成）。完成的日程会同步完成它关联的任务。",
    destructive: false,
    params: z.object({
      title: z.string().min(1).describe("现有日程标题（支持部分匹配）"),
      done: z.boolean().optional().describe("true=完成（默认），false=撤销"),
    }),
    execute: async (args, ctx) => {
      const deps = createScheduleDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const event = await findEventOf(dateKey, args.title);
      const done = args.done ?? true;
      await setEventDone(deps, dateKey, event.id, done, ctx.now);
      // 联动组合（docs/08 §3）：完成日程 → 同步完成任务（正向单向）
      let extra = "";
      if (done && event.refKind === "task" && event.refId !== undefined) {
        const task = await db.tasks.get(event.refId);
        if (
          task !== undefined &&
          task.deletedAt === NOT_DELETED &&
          task.status !== "done"
        ) {
          await setTaskStatus(createTaskDeps(db), task, "done", ctx.now);
          extra = `，关联任务「${task.title}」已同步完成`;
        }
      }
      return done
        ? `「${event.title}」已完成${extra}`
        : `「${event.title}」已撤销完成`;
    },
  },
  {
    name: "schedule_delete",
    description: "删除一条日程（进确认流程，不会直接删）。",
    destructive: true,
    params: z.object({
      title: z.string().min(1).describe("现有日程标题（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const deps = createScheduleDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const event = await findEventOf(dateKey, args.title);
      await removeEvent(deps, event.id);
      return `日程「${event.title}」已删除`;
    },
  },
  {
    name: "schedule_report",
    description:
      '播报今天（或指定说到的某天）的日程安排，按时间顺序列出。用户问"今天日程是什么"时使用。与 daily_plan_report 的分界：说"日程"用这个，说"计划"用那个。',
    destructive: false,
    params: z.object({}),
    execute: async (_, ctx) => {
      const deps = createScheduleDeps(db);
      const dateKey = dateKeyOf(ctx.now, localTzOffsetMinutes());
      const events = await listDayEvents(deps, dateKey);
      if (events.length === 0)
        return '今天日程还是空的。说"6点到7点背单词"这样带时间的话，我来排。';
      const lines = events.map((event) => {
        const flag = event.done ? "✓" : "·";
        return `${flag} ${clockLabelOf(event.startMin)}–${clockLabelOf(event.endMin)} ${event.title}`;
      });
      return `今天共 ${events.length} 条日程：\n${lines.join("\n")}`;
    },
  },

  /* ── 倒计时（总览 hero，docs/10 §AI） ── */
  {
    name: "countdown_create",
    description:
      '新建倒计时（总览页顶部）。两种说法都支持：①时长式——"建一个倒计时：考研 100 天"、"倒计时 30 分钟后提醒我"，填 amount + unit；②日期式——"倒计时到 10 月 1 日 9 点半"、"距离答辩还有"，填 date + time。日期式必须把用户说的日期换算成 YYYY-MM-DD、时刻换算成 HH:mm。',
    destructive: false,
    params: z.object({
      name: z.string().min(1).describe('倒计时名称，如"考研"'),
      amount: z
        .number()
        .positive()
        .optional()
        .describe("时长数量（时长式填，日期式不填）"),
      unit: z
        .enum(["minute", "hour", "day"])
        .describe("时间单位：minute / hour / day（同时决定卡片主数字的精度）"),
      date: z.string().optional().describe("日期式的目标日期，格式 YYYY-MM-DD"),
      time: z
        .string()
        .optional()
        .describe("日期式的目标时刻，24 小时制 HH:mm，如 09:30"),
    }),
    execute: async (args, ctx) => {
      // 日期式优先：把日期 + 时刻换算成目标时刻（锚点时区），amount 只用于文案
      let targetAt: number | undefined;
      if (args.date !== undefined && args.time !== undefined) {
        targetAt = targetAtOfDateTime(
          args.date,
          args.time,
          localTzOffsetMinutes(),
        );
        if (targetAt === undefined)
          return `日期或时刻看不懂：「${args.date} ${args.time}」，请用 2026-10-01 + 09:30 这样的格式。`;
        if (targetAt <= ctx.now)
          return `${args.date} ${args.time} 已经过去了，换一个将来的时间吧。`;
      }
      const amount = args.amount ?? 0;
      if (targetAt === undefined && amount <= 0) {
        return '缺时间：要么说"考研 100 天"，要么说"倒计时到 10 月 1 日 9:30"。';
      }
      const created = await createCountdown(
        createCountdownDeps(db),
        { name: args.name, amount, unit: args.unit, targetAt },
        ctx.now,
      );
      const label =
        targetAt !== undefined
          ? `目标 ${args.date} ${args.time}`
          : `还有 ${describeAmount(amount, args.unit)}`;
      return `倒计时「${created.name}」已开始：${label}（总览页顶部可见）`;
    },
  },
  {
    name: "countdown_adjust",
    description:
      '给倒计时加时或减时。用户说"给考研倒计时加 2 小时"、"考研倒计时减一天"时使用。用户表达的单位会换算成该倒计时自己的单位。',
    destructive: false,
    params: z.object({
      name: z.string().min(1).describe("倒计时名称（支持部分匹配）"),
      amount: z.number().positive().describe("数量，正数"),
      unit: z.enum(["minute", "hour", "day"]).describe("用户说的单位"),
      direction: z.enum(["add", "sub"]).describe("add=加时，sub=减时"),
    }),
    execute: async (args, ctx) => {
      const deps = createCountdownDeps(db);
      const item = await findCountdown(deps, args.name);
      // 换算：用户单位 → 条目单位（可能是分数，如"加 2 小时"对应 1/12 天）
      const unit = args.unit as CountdownUnit;
      const steps = (args.amount * UNIT_MS[unit]) / UNIT_MS[item.unit];
      const updated = await adjustCountdown(
        deps,
        item,
        args.direction === "add" ? steps : -steps,
        ctx.now,
      );
      return `「${updated.name}」已${args.direction === "add" ? "加" : "减"} ${describeAmount(args.amount, args.unit)}，剩余 ${formatRemaining(remainingMsOf(updated, ctx.now))}`;
    },
  },
  {
    name: "countdown_pause",
    description:
      '暂停或继续倒计时。用户说"暂停考研倒计时"、"继续倒计时"时使用。',
    destructive: false,
    params: z.object({
      name: z.string().min(1).describe("倒计时名称（支持部分匹配）"),
      paused: z.boolean().optional().describe("true=暂停（默认），false=继续"),
    }),
    execute: async (args, ctx) => {
      const deps = createCountdownDeps(db);
      const item = await findCountdown(deps, args.name);
      const shouldPause = args.paused ?? true;
      const updated = shouldPause
        ? await pauseCountdown(deps, item, ctx.now)
        : await resumeCountdown(deps, item, ctx.now);
      return shouldPause
        ? `「${updated.name}」已暂停，剩余 ${formatRemaining(remainingMsOf(updated, ctx.now))} 冻结中`
        : `「${updated.name}」已继续，剩余 ${formatRemaining(remainingMsOf(updated, ctx.now))}`;
    },
  },
  {
    name: "countdown_remove",
    description: "删除倒计时（进回收站，可恢复）。",
    destructive: true,
    params: z.object({
      name: z.string().min(1).describe("倒计时名称（支持部分匹配）"),
    }),
    execute: async (args, ctx) => {
      const deps = createCountdownDeps(db);
      const item = await findCountdown(deps, args.name);
      await removeCountdown(deps, item.id, ctx.now);
      return `倒计时「${item.name}」已删除（回收站可恢复）`;
    },
  },
  {
    name: "countdown_report",
    description:
      '播报全部倒计时的剩余时间。用户问"还有多少天考研"、"倒计时还剩多久"时使用。',
    destructive: false,
    params: z.object({}),
    execute: async (_, ctx) => {
      const items = await listCountdowns(createCountdownDeps(db));
      if (items.length === 0)
        return '还没有倒计时。说"建一个倒计时：考研 100 天"试试。';
      const lines = items.map((item) => {
        const rest = formatRemaining(remainingMsOf(item, ctx.now));
        return `· ${item.name}：${rest}${isPaused(item) ? "（已暂停）" : ""}`;
      });
      return `共 ${items.length} 个倒计时：\n${lines.join("\n")}`;
    },
  },

  /* 应用 */
  {
    name: "navigate",
    description: "跳转到指定页面：总览 / 计划 / 执行 / 复盘 / 待办 / 设置。",
    destructive: false,
    params: z.object({ page: z.string().min(1).describe("页面名") }),
    execute: async (args, ctx) => {
      const routes: Record<string, string> = {
        总览: "/",
        计划: "/plans",
        执行: "/execute",
        复盘: "/review",
        待办: "/todos",
        设置: "/settings",
        日程: "/schedule",
        统计: "/stats",
      };
      const to = routes[args.page] ?? routes[args.page.replace("页", "")];
      if (to === undefined) throw new Error(`没有「${args.page}」这个页面`);
      await ctx.navigate(to);
      return `已打开${args.page}`;
    },
  },
  {
    name: "theme_set",
    description: "切换主题：纸面（浅色）或墨夜（深色）。",
    destructive: false,
    params: z.object({ mode: z.string().min(1).describe("纸面 | 墨夜") }),
    execute: async (args) => {
      if (args.mode.includes("夜") || args.mode.includes("深")) {
        useAppearanceStore.getState().setTheme("dark");
        return "已切换到墨夜主题";
      }
      if (
        args.mode.includes("纸") ||
        args.mode.includes("浅") ||
        args.mode.includes("亮")
      ) {
        useAppearanceStore.getState().setTheme("light");
        return "已切换到纸面主题";
      }
      throw new Error(`不认识的主题「${args.mode}」，可用：纸面 / 墨夜`);
    },
  },
  {
    name: "overview_report",
    description:
      '播报今日总览：投入时长、活跃计划、待办、复盘完成情况。用户问"今天怎么样"时使用。',
    destructive: false,
    params: z.object({}),
    execute: async (_, ctx) => {
      const tz = localTzOffsetMinutes();
      const key = dateKeyOf(ctx.now, tz);
      const dayStart = startOfDayMs(key, tz);

      const [plans, todos, sessions, entries, schedules] = await Promise.all([
        db.plans.where("deletedAt").equals(NOT_DELETED).toArray(),
        db.todos.where("deletedAt").equals(NOT_DELETED).toArray(),
        createSessionDeps(db).sessions.inRange(
          dayStart - 86_400_000,
          dayStart + 86_400_000,
        ),
        db.reviewEntries.where("deletedAt").equals(NOT_DELETED).toArray(),
        db.reviewSchedules.where("deletedAt").equals(NOT_DELETED).toArray(),
      ]);

      const minutes =
        sessions
          .filter(
            (session) =>
              session.endedAt !== undefined && session.startedAt >= dayStart,
          )
          .reduce(
            (sum, session) => sum + sessionDurationMs(session, ctx.now),
            0,
          ) / 60_000;
      const activePlans = plans.filter(
        (plan) => plan.status === "active",
      ).length;
      const openTodos = todos.filter((todo) => todo.status !== "done").length;

      const schedule = schedules
        .filter((item) => item.enabled)
        .sort((a, b) => a.order - b.order)[0];
      let reviewText = "";
      if (schedule !== undefined) {
        const slots = deriveSlots(schedule, key, tz);
        const reviewed = slots.filter((slot) =>
          entries.some(
            (entry) =>
              entry.scheduleId === schedule.id &&
              entry.slotStart === slot.start,
          ),
        ).length;
        reviewText = `，复盘 ${reviewed}/${slots.length} 格`;
      }

      return `今日专注 ${Math.round(minutes)} 分钟，活跃计划 ${activePlans} 个，未完成待办 ${openTodos} 条${reviewText}`;
    },
  },
];

/* ── 每日计划辅助（联动组合发生在 widgets 层 —— 分层规则见 docs/07 §3） ── */

async function getDailyPlanOf(
  deps: ReturnType<typeof createDailyPlanDeps>,
  dateKey: string,
) {
  const plan = await getDailyPlan(deps, dateKey);
  if (plan === undefined)
    throw new Error('今天的计划还是空的。先说"制定今天的计划：…"或加一项');
  return plan;
}

function matchDailyItem<T extends { id: string; title: string }>(
  plan: { items: readonly T[] },
  query: string,
): T {
  return matchUnique("今天计划里的", query, plan.items);
}

/* ── 日程辅助 ── */

/** 分钟数 → "H:MM"（日程面板同款显示） */
function clockLabelOf(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/** 按标题在当天日程里唯一定位（包含匹配，命中多个/零个都报错） */
async function findEventOf(dateKey: string, title: string) {
  const events = await listDayEvents(createScheduleDeps(db), dateKey);
  return matchUnique("今天的日程", title, events);
}

/* ── 倒计时辅助 ── */

/** 按名称在倒计时里唯一定位（包含匹配，命中多个/零个都报错） */
async function findCountdown(
  deps: ReturnType<typeof createCountdownDeps>,
  name: string,
): Promise<Countdown> {
  const items = await listCountdowns(deps);
  return matchUnique("倒计时", name, items, (item) => item.name);
}

/* ── 查找辅助 ── */

/** 按名称查工具（找不到返回 undefined —— 调用方负责反问） */
export function toolByName(name: string): AssistantTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
