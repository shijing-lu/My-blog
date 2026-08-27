/**
 * 学习打卡数据访问层：任务 CRUD + 打卡 toggle + 连击统计
 *
 * - date 一律存 YYYY-MM-DD 字符串（本地时区，与 todos 一致，防时区漂移）；
 * - 打卡记录 taskId + date 唯一（同日同任务一条，toggle 幂等）；
 * - 连击：从今天（已打）或昨天（今天未打）往前连续数；
 * - 补签：date 不能早于「今天 - maxMakeupDays」天。
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { checkinRecords, checkinTasks } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { CheckinRecord, CheckinTask, CheckinTaskView } from '../../db/types';

/** 本地时区 YYYY-MM-DD */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 加天数（不跨月问题由 Date 自动处理） */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ---------------- 查询 ---------------- */

/** 列出全部打卡任务（含今日状态/连击/累计/记录日期） */
export async function listCheckinTasks(now = new Date()): Promise<CheckinTaskView[]> {
  const tasks = (await db.select().from(checkinTasks).orderBy(asc(checkinTasks.sort), asc(checkinTasks.createdAt))) as CheckinTask[];
  const allRecords = (await db.select().from(checkinRecords).orderBy(asc(checkinRecords.date))) as CheckinRecord[];

  const todayKey = dateKey(now);
  const byTask = new Map<string, Set<string>>();
  allRecords.forEach((r) => {
    const set = byTask.get(r.taskId) ?? new Set<string>();
    set.add(r.date);
    byTask.set(r.taskId, set);
  });

  return tasks.map((t) => {
    const dates = byTask.get(t.id) ?? new Set<string>();
    return {
      ...t,
      todayChecked: dates.has(todayKey),
      streakDays: computeStreak(dates, now),
      totalCount: dates.size,
      recordDates: [...dates].sort(),
    };
  });
}

/** 计算连续打卡天数 */
export function computeStreak(dates: Set<string>, now = new Date()): number {
  const todayKey = dateKey(now);
  // 今天未打则从昨天开始数（给"今天还没打"留余地）
  let cursor = dates.has(todayKey) ? now : addDays(now, -1);
  let streak = 0;
  while (dates.has(dateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* ---------------- 打卡 toggle ---------------- */

/**
 * 打卡 / 取消打卡（同日同任务幂等）
 * @param taskId 任务 id
 * @param date YYYY-MM-DD（今天或补签日）
 * @returns true=已打卡 false=已取消
 */
export async function toggleCheckin(taskId: string, date: string, now = new Date()): Promise<boolean> {
  const existing = await db
    .select()
    .from(checkinRecords)
    .where(and(eq(checkinRecords.taskId, taskId), eq(checkinRecords.date, date)))
    .limit(1);
  if (existing[0]) {
    await db.delete(checkinRecords).where(eq(checkinRecords.id, existing[0].id));
    return false;
  }
  // 校验补签范围
  const task = (await db.select().from(checkinTasks).where(eq(checkinTasks.id, taskId)).limit(1)) as CheckinTask[];
  if (!task[0]) throw new Error('任务不存在');
  const maxMakeup = Math.max(0, task[0].maxMakeupDays);
  // 「今天」以服务器时区为准，但客户端可能处于更早/更晚时区（如东八区晚于 UTC）。
  // 为兼容"用户本地今天"与"服务器 UTC 今天"相差 1 天的情况：
  // - 补签最早日期按服务器今天往前推（maxMakeup 天）；
  // - 允许 date 至多等于「服务器今天 + 1 天」（客户端时区超前一天的场景），再往后才拒绝。
  const earliest = dateKey(addDays(now, -maxMakeup));
  const latest = dateKey(addDays(now, 1));
  if (date < earliest) throw new Error('超出可补签范围');
  if (date > latest) throw new Error('不能为未来日期打卡');

  await db
    .insert(checkinRecords)
    .values({ id: randomUUID(), taskId, date, createdAt: new Date() })
    .onConflictDoNothing();
  return true;
}

/* ---------------- 任务 CRUD ---------------- */

export async function addCheckinTask(input: { name: string; icon: string | null; maxMakeupDays: number; sort?: number }): Promise<CheckinTask> {
  const rows = await db
    .insert(checkinTasks)
    .values({
      id: randomUUID(),
      name: input.name,
      icon: input.icon,
      maxMakeupDays: Math.max(0, Math.min(30, Math.round(input.maxMakeupDays))),
      sort: input.sort ?? 0,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as CheckinTask;
}

export async function updateCheckinTask(
  id: string,
  patch: { name?: string; icon?: string | null; maxMakeupDays?: number; sort?: number },
): Promise<CheckinTask | null> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.maxMakeupDays !== undefined) set.maxMakeupDays = Math.max(0, Math.min(30, Math.round(patch.maxMakeupDays)));
  if (patch.sort !== undefined) set.sort = patch.sort;
  const rows = await db.update(checkinTasks).set(set).where(eq(checkinTasks.id, id)).returning();
  return (rows[0] as CheckinTask | undefined) ?? null;
}

/** 删除任务（级联删除其下记录） */
export async function deleteCheckinTask(id: string): Promise<void> {
  await db.delete(checkinRecords).where(eq(checkinRecords.taskId, id));
  await db.delete(checkinTasks).where(eq(checkinTasks.id, id));
}

/** 按日期范围批量查询记录（补签弹窗日期选择用；返回已打卡日期集合） */
export async function getCheckedDates(taskId: string, from: Date, to: Date): Promise<string[]> {
  const rows = await db
    .select({ date: checkinRecords.date })
    .from(checkinRecords)
    .where(and(eq(checkinRecords.taskId, taskId), gte(checkinRecords.date, dateKey(from)), lte(checkinRecords.date, dateKey(to))));
  return rows.map((r) => r.date);
}
