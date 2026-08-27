/**
 * 学习模式数据访问层：番茄记录 / 任务 / 打断 + 统计聚合
 *
 * - 按天统计用 YYYY-MM-DD 字符串（本地时区），与 todos 一致，避免时区漂移；
 * - 番茄记录仅落"完整完成"（completed=true），作废不上报；
 * - 公开统计只返回聚合数字，不暴露任务名/打断内容。
 */
import { asc, count, desc, eq, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { settings, studyDistractions, studySessions, studyTasks } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { StudyDistraction, StudySession, StudyStats, StudyTask, StudyTaskView } from '../../db/types';

/** 本地时区 YYYY-MM-DD */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地时区 YYYY-MM-DD 的当天零点（Date） */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ---------------- 番茄记录 ---------------- */

/** 新增一条完成番茄 */
export async function addStudySession(input: { taskId?: string | null; durationSec: number }): Promise<StudySession> {
  const rows = await db
    .insert(studySessions)
    .values({
      id: randomUUID(),
      taskId: input.taskId ?? null,
      durationSec: Math.max(1, Math.round(input.durationSec)),
      completed: true,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as StudySession;
}

/* ---------------- 任务 ---------------- */

/** 列出全部任务（新 → 旧，含已完成番茄数） */
export async function listStudyTasks(): Promise<StudyTaskView[]> {
  const tasks = (await db
    .select()
    .from(studyTasks)
    .orderBy(asc(studyTasks.createdAt))) as StudyTask[];
  const rows = await db
    .select({ taskId: studySessions.taskId, count: count() })
    .from(studySessions)
    .where(eq(studySessions.completed, true))
    .groupBy(studySessions.taskId);
  const byTask = new Map<string, number>();
  rows.forEach((r) => {
    if (r.taskId) byTask.set(r.taskId, r.count);
  });
  return tasks.map((t) => ({ ...t, pomodoroCount: byTask.get(t.id) ?? 0 }));
}

/** 新增任务 */
export async function addStudyTask(input: { title: string; estPomodoros: number }): Promise<StudyTask> {
  const now = new Date();
  const rows = await db
    .insert(studyTasks)
    .values({
      id: randomUUID(),
      title: input.title,
      estPomodoros: Math.max(1, Math.round(input.estPomodoros)),
      done: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0] as StudyTask;
}

/** 更新任务（标题 / 预估 / 完成状态） */
export async function updateStudyTask(
  id: string,
  patch: { title?: string; estPomodoros?: number; done?: boolean },
): Promise<StudyTask | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.estPomodoros !== undefined) set.estPomodoros = Math.max(1, Math.round(patch.estPomodoros));
  if (patch.done !== undefined) set.done = patch.done;
  const rows = await db.update(studyTasks).set(set).where(eq(studyTasks.id, id)).returning();
  return (rows[0] as StudyTask | undefined) ?? null;
}

/** 删除任务 */
export async function deleteStudyTask(id: string): Promise<StudyTask | null> {
  const rows = await db.delete(studyTasks).where(eq(studyTasks.id, id)).returning();
  return (rows[0] as StudyTask | undefined) ?? null;
}

/* ---------------- 打断记录 ---------------- */

/** 列出全部打断记录（新 → 旧） */
export async function listStudyDistractions(): Promise<StudyDistraction[]> {
  return (await db
    .select()
    .from(studyDistractions)
    .orderBy(desc(studyDistractions.createdAt))) as StudyDistraction[];
}

/** 新增打断记录 */
export async function addStudyDistraction(input: { type: 'internal' | 'external'; note: string }): Promise<StudyDistraction> {
  const rows = await db
    .insert(studyDistractions)
    .values({ id: randomUUID(), type: input.type, note: input.note, createdAt: new Date() })
    .returning();
  return rows[0] as StudyDistraction;
}

/** 删除打断记录 */
export async function deleteStudyDistraction(id: string): Promise<StudyDistraction | null> {
  const rows = await db.delete(studyDistractions).where(eq(studyDistractions.id, id)).returning();
  return (rows[0] as StudyDistraction | undefined) ?? null;
}

/* ---------------- 统计聚合（公开） ---------------- */

/** 构建学习热力图：以"今天"为终点往前 12 个月，count = 当日专注分钟数 */
function buildStudyHeatmap(sessions: StudySession[], end: Date, months = 12): StudyStats['heatmap'] {
  // 按日聚合分钟数（本地时区）
  const byDay = new Map<string, number>();
  sessions.forEach((s) => {
    const k = dateKey(s.createdAt);
    byDay.set(k, (byDay.get(k) ?? 0) + Math.round(s.durationSec / 60));
  });

  // 网格起始：往前 months-1 个月的 1 号所在周的周日
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
  const endDay = startOfDay(end);
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const weeks: Array<Array<{ date: string; count: number }>> = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= endDay.getTime()) {
    const week: Array<{ date: string; count: number }> = [];
    for (let d = 0; d < 7; d += 1) {
      const day = new Date(cursor);
      day.setDate(day.getDate() + d);
      const k = dateKey(day);
      week.push({ date: k, count: byDay.get(k) ?? 0 });
    }
    weeks.push(week);
    cursor.setDate(cursor.getDate() + 7);
  }

  // 月度聚合（旧 → 新）
  const monthly: Array<{ month: string; total: number }> = [];
  const mCursor = new Date(start);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (mCursor.getTime() <= lastMonth.getTime()) {
    const mk = `${mCursor.getFullYear()}-${String(mCursor.getMonth() + 1).padStart(2, '0')}`;
    let total = 0;
    weeks.forEach((week) => week.forEach((day) => {
      if (day.date.startsWith(mk)) total += day.count;
    }));
    monthly.push({ month: mk, total });
    mCursor.setMonth(mCursor.getMonth() + 1);
  }

  return { weeks, monthly };
}

/** 公开统计：今日 / 连续 / 累计 / 热力图 / 近 7 天 */
export async function getStudyStats(now = new Date()): Promise<StudyStats> {
  const sessions = (await db
    .select()
    .from(studySessions)
    .where(eq(studySessions.completed, true))) as StudySession[];

  // 今日
  const todayKey = dateKey(now);
  const todaySessions = sessions.filter((s) => dateKey(s.createdAt) === todayKey);
  const todayMinutes = todaySessions.reduce((n, s) => n + Math.round(s.durationSec / 60), 0);

  // 今日打断
  const todayStart = startOfDay(now);
  const todayDistractions = await db
    .select({ count: count() })
    .from(studyDistractions)
    .where(gte(studyDistractions.createdAt, todayStart));
  const distractionCount = todayDistractions[0]?.count ?? 0;

  // 累计
  const totalPomodoros = sessions.length;
  const totalMinutes = sessions.reduce((n, s) => n + Math.round(s.durationSec / 60), 0);

  // 连续学习天数：从今天（若有）或昨天开始往前数
  const activeDays = new Set(sessions.map((s) => dateKey(s.createdAt)));
  let streakDays = 0;
  let cursor = startOfDay(now);
  if (!activeDays.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(dateKey(cursor))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 近 7 天每日分钟数（旧 → 新）
  const weeklyMinutes: Array<{ date: string; minutes: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = dateKey(day);
    const minutes = sessions
      .filter((s) => dateKey(s.createdAt) === k)
      .reduce((n, s) => n + Math.round(s.durationSec / 60), 0);
    weeklyMinutes.push({ date: k, minutes });
  }

  return {
    todayMinutes,
    todayPomodoros: todaySessions.length,
    todayDistractions: distractionCount,
    streakDays,
    totalPomodoros,
    totalHours: Number((totalMinutes / 60).toFixed(1)),
    heatmap: buildStudyHeatmap(sessions, now),
    weeklyMinutes,
  };
}

/** 当日目标番茄数（settings KV） */
export async function getDailyGoal(): Promise<number> {
  const rows = await db.select().from(settings).where(eq(settings.key, 'study_daily_goal')).limit(1);
  return rows[0] ? Number(rows[0].value) || 0 : 0;
}

/** 保存当日目标番茄数 */
export async function setDailyGoal(value: number): Promise<void> {
  const v = Math.max(0, Math.round(value));
  const now = new Date();
  await db
    .insert(settings)
    .values({ key: 'study_daily_goal', value: String(v), updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(v), updatedAt: now } });
}
