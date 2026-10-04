/**
 * 统计聚合（跨实体，故属 features 而非 entities）
 * 依据：01-需求文档 FR-STATS-*；02-技术架构文档 §4.5
 *
 * 为什么放纯函数而不是放进组件：
 *   统计口径是**业务规则**，不是展示细节。同一个"完成率"在总览页、
 *   计划详情、复盘页都要一致 —— 口径分散在三处迟早会漂移。
 *   集中在这里，测试一处、全站受益。
 *
 * 为什么放 features 而不是 entities：
 *   它**运行时**引用多个实体切片（session 的时长计算、axis 的分区判定）。
 *   entities 层内禁止跨切片运行时互引（会形成环），
 *   而 features → entities 是合法方向 —— 这正是 FSD 对"跨实体聚合"的安放位置。
 *
 * 性能：全部是 O(n) 单遍聚合。万级数据在现代设备上 < 5ms，
 * 若将来需要更高量级，再把这些函数挪进 Web Worker（接口不变）。
 */

import type { Plan, PlanStatus } from "@/cadence/entities/plan";
import type { Task, TaskStatus } from "@/cadence/entities/task";
import type { Session } from "@/cadence/entities/session";
import type { Todo } from "@/cadence/entities/todo";
import type { AxisConfig, ZoneId } from "@/cadence/entities/axis";
import { sessionDurationMs } from "@/cadence/entities/session";
import { resolveZones } from "@/cadence/entities/axis";
import { addDays, dateKeyOf } from "@/cadence/shared/db/time";
import { NOT_DELETED } from "@/cadence/shared/model/entity";

/** 计划进度：任务完成率。没有任务时返回 null —— "0/0 = 0%" 是在说谎 */
export interface PlanProgress {
  total: number;
  done: number;
  /** 0–100；无任务时为 null（调用方应显示"暂无任务"而不是 0%） */
  ratio: number | null;
}

/**
 * 计划进度（只统计直接子任务）
 *
 * 为什么不算叶子任务的加权：嵌套任务的"完成"语义是产品决策
 * （父任务勾选 = 子任务全部完成？还是父任务独立？），
 * 在 M3 实现任务树交互时再定。这里只做无歧义的部分。
 */
export function planProgress(
  planId: string,
  tasks: readonly Task[],
): PlanProgress {
  const direct = tasks.filter(
    (task) => task.planId === planId && task.parentId === undefined,
  );
  const done = direct.filter((task) => task.status === "done").length;
  return {
    total: direct.length,
    done,
    ratio:
      direct.length === 0 ? null : Math.round((done / direct.length) * 100),
  };
}

/** 按状态分组的任务数（看板列头徽标用） */
export function countByTaskStatus(
  tasks: readonly Task[],
): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    todo: 0,
    doing: 0,
    done: 0,
    blocked: 0,
  };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

/** 按状态分组的计划数 */
export function countByPlanStatus(
  plans: readonly Plan[],
): Record<PlanStatus, number> {
  const counts: Record<PlanStatus, number> = {
    active: 0,
    paused: 0,
    completed: 0,
    archived: 0,
  };
  for (const plan of plans) counts[plan.status] += 1;
  return counts;
}

/** 每日投入时长（UTC ms → 锚点时区的 dateKey → 毫秒） */
export function timeByDay(
  sessions: readonly Session[],
  tzOffsetMinutes: number,
): Map<string, number> {
  const byDay = new Map<string, number>();
  const now = Date.now();
  for (const session of sessions) {
    // 进行中的记录按"到当前时刻"计算，但只在它的起点已有归属时计入
    const duration = sessionDurationMs(session, now);
    if (duration <= 0) continue;
    // 跨日记录按起点日归属（不做日内切分）：
    // 日内切分会让"同一会话出现在两天"的展示复杂化，而起点日更符合直觉
    const key = dateKeyOf(session.startedAt, tzOffsetMinutes);
    byDay.set(key, (byDay.get(key) ?? 0) + duration);
  }
  return byDay;
}

/** 每个计划的投入时长（含无归属的"临时投入"） */
export function timeByPlan(
  sessions: readonly Session[],
  now: number,
): Map<string | undefined, number> {
  const byPlan = new Map<string | undefined, number>();
  for (const session of sessions) {
    const duration = sessionDurationMs(session, now);
    if (duration <= 0) continue;
    const key = session.planId;
    byPlan.set(key, (byPlan.get(key) ?? 0) + duration);
  }
  return byPlan;
}

/** 实际投入 / 预估 的比值（分钟）。预估缺失的任务不计入 —— 分母为 0 的比值没有意义 */
export function estimateRatio(
  tasks: readonly Task[],
  sessions: readonly Session[],
  now: number,
): { estimatedMinutes: number; actualMinutes: number; ratio: number | null } {
  const withEstimate = new Set(
    tasks.filter((t) => t.estimateMinutes !== undefined).map((t) => t.id),
  );
  let estimatedMinutes = 0;
  for (const task of tasks) {
    if (task.estimateMinutes !== undefined)
      estimatedMinutes += task.estimateMinutes;
  }

  let actualMinutes = 0;
  for (const session of sessions) {
    if (session.taskId === undefined || !withEstimate.has(session.taskId))
      continue;
    actualMinutes += sessionDurationMs(session, now) / 60_000;
  }

  return {
    estimatedMinutes,
    actualMinutes: Math.round(actualMinutes),
    ratio:
      estimatedMinutes === 0
        ? null
        : Math.round((actualMinutes / estimatedMinutes) * 100),
  };
}

export interface ZoneCount {
  zoneId: ZoneId;
  count: number;
  /** 未完成（open/doing）的数量 —— 看板上的"还有多少没做" */
  openCount: number;
}

/**
 * 按分区聚合待办数量
 *
 * 用 resolveZones 的批量版本：预先排序 regions 一次，
 * 避免 200 条待办各排序一次（见 zone.ts 的说明）。
 */
export function countByZone(
  axis: AxisConfig,
  todos: readonly Todo[],
): Map<ZoneId, ZoneCount> {
  const points = todos.map((todo) => todo.coordinate);
  const zoneIds = resolveZones(axis, points);

  const result = new Map<ZoneId, ZoneCount>();
  for (const region of axis.regions) {
    result.set(region.id, { zoneId: region.id, count: 0, openCount: 0 });
  }

  todos.forEach((todo, index) => {
    const zoneId = zoneIds[index];
    // 理论上不会发生（resolveZones 与 points 一一对应），
    // 但 noUncheckedIndexedAccess 要求显式处理 —— 静默跳过比写进错误分区安全
    if (zoneId === undefined) return;
    const entry = result.get(zoneId) ?? { zoneId, count: 0, openCount: 0 };
    entry.count += 1;
    if (todo.status === "open" || todo.status === "doing") entry.openCount += 1;
    result.set(zoneId, entry);
  });

  return result;
}

/** 未完成且即将到期（NFR：复合索引 [status+dueAt] 支撑的查询口径） */
export function dueSoon(
  todos: readonly Todo[],
  now: number,
  withinMs: number,
): Todo[] {
  return todos
    .filter(
      (todo) =>
        (todo.status === "open" || todo.status === "doing") &&
        todo.dueAt !== undefined,
    )
    .filter((todo) => {
      const dueAt = todo.dueAt;
      if (dueAt === undefined) return false;
      const remaining = dueAt - now;
      return remaining >= 0 && remaining <= withinMs;
    })
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
}

/** 连续复盘天数（从某天往回数，含当天）。空档即断；上限 366 防数据异常死循环 */
export function reviewStreak(
  entries: readonly { dateKey: string }[],
  fromDateKey: string,
  tzOffsetMinutes: number,
): number {
  const days = new Set(entries.map((entry) => entry.dateKey));
  let streak = 0;
  let cursor = fromDateKey;
  for (let i = 0; i < 366; i += 1) {
    if (!days.has(cursor)) break;
    streak += 1;
    cursor = addDays(cursor, -1, tzOffsetMinutes);
  }
  return streak;
}

/* ── 专注统计面板（docs/09）────────────────────────────────────────────── */

/** 单日专注分钟 */
export interface DayFocus {
  dateKey: string;
  minutes: number;
}

/**
 * 近 N 天逐日专注分钟（含 todayKey，往前推）。
 * 没有数据的天补 0 —— 图表需要连续的时间轴，缺轴会误读成"没有那一天"。
 */
export function dailyFocusMinutes(
  sessions: readonly Session[],
  tz: number,
  dayCount: number,
  todayKey: string,
): DayFocus[] {
  const byDay = timeByDay(sessions, tz);
  const out: DayFocus[] = [];
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const key = addDays(todayKey, -i, tz);
    out.push({
      dateKey: key,
      minutes: Math.round(((byDay.get(key) ?? 0) / 60_000) * 10) / 10,
    });
  }
  return out;
}

/**
 * 一天 24 小时的专注分布（按会话**开始时刻**的小时归桶，分钟）。
 * 与 timeByDay 的"起点归属"同一纪律；起点日不切分、起点小时同理。
 */
export function hourHistogram(
  sessions: readonly Session[],
  tz: number,
  now: number,
): number[] {
  const bins = new Array<number>(24).fill(0);
  for (const session of sessions) {
    const duration = sessionDurationMs(session, now);
    if (duration <= 0) continue;
    const hour = new Date(session.startedAt + tz * 60_000).getUTCHours();
    bins[hour] = bins[hour]! + duration / 60_000;
  }
  return bins.map((value) => Math.round(value));
}

/** 连续专注天数（每天 > 0 分钟算一天；从最后一天往回数，空档即断） */
export function focusStreak(days: readonly DayFocus[]): number {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i]!.minutes > 0) streak += 1;
    else break;
  }
  return streak;
}

/** 甜甜圈/条形图的通用切片 */
export interface ShareSlice {
  label: string;
  minutes: number;
}

/** 按计划聚合的投入占比（含"临时投入"桶；含进行中的会话） */
export function shareByPlan(
  sessions: readonly Session[],
  plans: readonly Plan[],
  now: number,
): ShareSlice[] {
  const byPlan = timeByPlan(sessions, now);
  const nameOf = new Map(plans.map((plan) => [plan.id, plan.title]));
  const slices: ShareSlice[] = [];
  for (const [planId, ms] of byPlan) {
    const label =
      planId === undefined ? "临时投入" : (nameOf.get(planId) ?? "已删计划");
    slices.push({ label, minutes: Math.round(ms / 60_000) });
  }
  return slices
    .filter((slice) => slice.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

/** 任务维度的 Top N 投入（分钟） */
export function topTasks(
  sessions: readonly Session[],
  tasks: readonly Task[],
  now: number,
  limit = 5,
): ShareSlice[] {
  const byTask = new Map<string, number>();
  for (const session of sessions) {
    if (session.taskId === undefined) continue;
    const duration = sessionDurationMs(session, now);
    if (duration <= 0) continue;
    byTask.set(session.taskId, (byTask.get(session.taskId) ?? 0) + duration);
  }
  const nameOf = new Map(tasks.map((task) => [task.id, task.title]));
  return [...byTask.entries()]
    .map(([taskId, ms]) => ({
      label: nameOf.get(taskId) ?? "已删任务",
      minutes: Math.round(ms / 60_000),
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
}

/* ── 按名称聚合的专注时长（spec 2026-09-19）──────────────────────────── */

/**
 * 一段专注的名字标签。口径唯一定义处（docs/09 §3）：
 * 任务标题 > 计划标题 > note > 「未注明」。
 * 名称来自外部传入的查名函数，保持纯函数、不触库。
 *
 * 契约：`nameOfTask` / `nameOfPlan` **必须**由调用方传入「已排除软删」的名称映射
 * （即 `deletedAt === NOT_DELETED` 的过滤在调用方做）。本函数不判断软删——软删项
 * 查不到名字时沿优先级链退回 note / 「未注明」，这样同名专注不会因为一条被软删而分裂成两个标签。
 */
export function focusLabelOf(
  session: Session,
  nameOfTask: (id: string) => string | undefined,
  nameOfPlan: (id: string) => string | undefined,
): string {
  if (session.taskId !== undefined) {
    const title = nameOfTask(session.taskId)?.trim();
    if (title) return title;
  }
  if (session.planId !== undefined) {
    const title = nameOfPlan(session.planId)?.trim();
    if (title) return title;
  }
  const note = session.note?.trim();
  if (note) return note;
  return "未注明";
}

/** 按名称聚合的一行：总分钟 + 段数 */
export interface FocusLabelStat extends ShareSlice {
  count: number;
}

/** 同名合并总时长，分钟降序；超出 limit 的尾部并入「其他（N 项）」 */
export function timeByFocusLabel(
  sessions: readonly Session[],
  tasks: readonly Task[],
  plans: readonly Plan[],
  now: number,
  limit = 10,
): FocusLabelStat[] {
  // 下面两处 deletedAt 过滤是对 focusLabelOf 契约（查名映射须已排除软删）的防御性兜底：
  // 调用方（面板查询）本来就只取未软删的行，这里重复一次是为了让直接传全表的调用也不会读到软删名。
  const taskTitles = new Map(
    tasks
      .filter((t) => t.deletedAt === NOT_DELETED)
      .map((t) => [t.id, t.title]),
  );
  const planTitles = new Map(
    plans
      .filter((p) => p.deletedAt === NOT_DELETED)
      .map((p) => [p.id, p.title]),
  );

  const grouped = new Map<string, { ms: number; count: number }>();
  for (const s of sessions) {
    const ms = sessionDurationMs(s, now);
    if (ms <= 0) continue;
    const label = focusLabelOf(
      s,
      (id) => taskTitles.get(id),
      (id) => planTitles.get(id),
    );
    const entry = grouped.get(label) ?? { ms: 0, count: 0 };
    entry.ms += ms;
    entry.count += 1;
    grouped.set(label, entry);
  }

  const stats = [...grouped.entries()]
    .map(([label, v]) => ({
      label,
      minutes: Math.round(v.ms / 60_000),
      count: v.count,
    }))
    .filter((slice) => slice.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  if (stats.length <= limit) return stats;
  const head = stats.slice(0, limit);
  const tail = stats.slice(limit);
  head.push({
    label: `其他（${tail.length} 项）`,
    minutes: tail.reduce((sum, slice) => sum + slice.minutes, 0),
    count: tail.reduce((sum, slice) => sum + slice.count, 0),
  });
  return head;
}
