/**
 * 日历数据访问层：待办 / 日记 / 重要日期（CRUD）
 *
 * - date 一律存 YYYY-MM-DD 字符串（按天语义，避免时区漂移）；
 * - 日记按日期唯一（一人一天一篇，upsert）。
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { todos, diaryEntries, calendarEvents } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { Todo, DiaryEntry, CalendarEvent } from '../../db/types';

/* ---------------- 待办 ---------------- */

/** 列出待办（可按日期过滤，按创建时间倒序） */
export async function listTodos(date?: string): Promise<Todo[]> {
  if (date) {
    return db.select().from(todos).where(eq(todos.date, date)).orderBy(todos.createdAt);
  }
  return db.select().from(todos).orderBy(todos.date);
}

/** 新增待办 */
export async function addTodo(date: string, text: string): Promise<Todo> {
  const rows = await db
    .insert(todos)
    .values({ id: randomUUID(), date, text, done: false, createdAt: new Date() })
    .returning();
  return rows[0] as Todo;
}

/** 更新待办（文本 / 完成状态） */
export async function updateTodo(
  id: string,
  patch: { text?: string; done?: boolean },
): Promise<Todo | null> {
  const rows = await db.update(todos).set(patch).where(eq(todos.id, id)).returning();
  return (rows[0] as Todo | undefined) ?? null;
}

/** 删除待办 */
export async function deleteTodo(id: string): Promise<Todo | null> {
  const rows = await db.delete(todos).where(eq(todos.id, id)).returning();
  return (rows[0] as Todo | undefined) ?? null;
}

/* ---------------- 日记 ---------------- */

/** 按日期读取日记 */
export async function getDiaryByDate(date: string): Promise<DiaryEntry | null> {
  const rows = await db.select().from(diaryEntries).where(eq(diaryEntries.date, date)).limit(1);
  return (rows[0] as DiaryEntry | undefined) ?? null;
}

/** 列出全部有日记的日期（网格标记用） */
export async function listDiaryDates(): Promise<string[]> {
  const rows = await db.select({ date: diaryEntries.date }).from(diaryEntries);
  return rows.map((r) => r.date);
}

/** 按日期 upsert 日记 */
export async function upsertDiary(date: string, title: string, content: string): Promise<DiaryEntry> {
  const now = new Date();
  const existing = await getDiaryByDate(date);
  if (existing) {
    const rows = await db
      .update(diaryEntries)
      .set({ title, content, updatedAt: now })
      .where(eq(diaryEntries.id, existing.id))
      .returning();
    return rows[0] as DiaryEntry;
  }
  const rows = await db
    .insert(diaryEntries)
    .values({ id: randomUUID(), date, title, content, createdAt: now, updatedAt: now })
    .returning();
  return rows[0] as DiaryEntry;
}

/* ---------------- 重要日期 ---------------- */

/** 列出全部重要日期（按日期升序） */
export async function listEvents(): Promise<CalendarEvent[]> {
  return db.select().from(calendarEvents).orderBy(calendarEvents.date);
}

/** 新增重要日期 */
export async function addEvent(
  title: string,
  date: string,
  repeat: boolean,
  lunar = false,
  lunarDate: string | null = null,
): Promise<CalendarEvent> {
  const rows = await db
    .insert(calendarEvents)
    .values({
      id: randomUUID(),
      title,
      date,
      repeat,
      lunar,
      lunarDate: lunar ? lunarDate : null,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as CalendarEvent;
}

/** 更新重要日期 */
export async function updateEvent(
  id: string,
  patch: { title?: string; date?: string; repeat?: boolean; lunar?: boolean; lunarDate?: string | null },
): Promise<CalendarEvent | null> {
  const rows = await db.update(calendarEvents).set(patch).where(eq(calendarEvents.id, id)).returning();
  return (rows[0] as CalendarEvent | undefined) ?? null;
}

/** 删除重要日期 */
export async function deleteEvent(id: string): Promise<CalendarEvent | null> {
  const rows = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning();
  return (rows[0] as CalendarEvent | undefined) ?? null;
}
