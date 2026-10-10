/**
 * 日程用例层（docs/08-日程面板.md）
 * ---------------------------------------------------------------------------
 * 职责边界与每日计划一致：只操作 scheduleEvents **这一张表**。
 * 与任务/今日计划的联动（完成事件→完成任务等）由调用方组合（pages 层），
 * 组合范本见 tests/unit/schedule.test.ts。
 *
 * 重叠策略（业界调研结论，docs/08 §2）：**拒绝落点 + 回弹** ——
 * 任何导致重叠的创建/移动/调长都会抛出业务错误，UI 不落库、块回弹原位。
 * 并排布局（overlap → side-by-side）列为后续演进项。
 *
 * 全部方法接收 now —— 与全站纪律一致。
 */

import type {
  ScheduleEvent,
  ScheduleEventId,
  ScheduleRefKind,
} from "@/cadence/entities/schedule";
import {
  clampSpan,
  DAY_TOTAL_MIN,
  MIN_DURATION_MIN,
  overlaps,
  parseScheduleText,
  scheduleEventIdOf,
  snapDown,
} from "@/cadence/entities/schedule";
import type { CadenceDatabase } from "@/cadence/data/db/database";
import { validTimeSpan } from '@/cadence/entities/schedule/time-input';

export interface ScheduleDeps {
  database: CadenceDatabase;
}

export function createScheduleDeps(database: CadenceDatabase): ScheduleDeps {
  return { database };
}

/** 某天的全部日程，按开始时间升序（面板自上而下渲染） */
export async function listDayEvents(
  deps: ScheduleDeps,
  dateKey: string,
): Promise<ScheduleEvent[]> {
  const events = await deps.database.scheduleEvents
    .where("dateKey")
    .equals(dateKey)
    .toArray();
  return events.sort((a, b) => a.startMin - b.startMin);
}

function assertNoOverlap(
  events: readonly ScheduleEvent[],
  candidate: { id?: string; startMin: number; endMin: number },
): void {
  const hit = events.find(
    (event) =>
      event.id !== candidate.id &&
      overlaps(event, {
        startMin: candidate.startMin,
        endMin: candidate.endMin,
      }),
  );
  if (hit !== undefined) {
    throw new Error(
      `与已有日程「${hit.title}」时间重叠。日程不允许叠加，请换个时间段`,
    );
  }
}

export interface EventDraft {
  title: string;
  startMin: number;
  endMin: number;
  note?: string | undefined;
  refKind?: ScheduleRefKind | undefined;
  refId?: string | undefined;
}

/** 新建日程：时间 clamp 到当天、时长合法性、重叠拒绝 */
export async function createEvent(
  deps: ScheduleDeps,
  dateKey: string,
  draft: EventDraft,
  now: number,
): Promise<ScheduleEvent> {
  const title = draft.title.trim();
  if (title.length === 0) throw new Error("日程标题不能为空");
  if (!validTimeSpan(draft.startMin, draft.endMin)) throw new Error('请输入当天有效的起止时间，结束须晚于开始');
  if (draft.endMin - draft.startMin < MIN_DURATION_MIN) {
    throw new Error(`日程至少要 ${MIN_DURATION_MIN} 分钟`);
  }

  const { startMin, endMin } = clampSpan(draft.startMin, draft.endMin);
  if (startMin < 0 || endMin > DAY_TOTAL_MIN)
    throw new Error("日程不能跨出当天（跨午夜暂不支持）");

  const events = await listDayEvents(deps, dateKey);
  assertNoOverlap(events, { startMin, endMin });

  const event: ScheduleEvent = {
    id: scheduleEventIdOf(dateKey, startMin, now % 1e6),
    dateKey,
    startMin,
    endMin,
    title,
    ...(draft.note !== undefined && draft.note.length > 0
      ? { note: draft.note }
      : {}),
    ...(draft.refKind !== undefined ? { refKind: draft.refKind } : {}),
    ...(draft.refId !== undefined ? { refId: draft.refId } : {}),
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  await deps.database.scheduleEvents.put(event);
  return event;
}

/** 拖拽移动：保持时长，改开始时间。重叠 → 抛错（UI 回弹原位） */
export async function moveEvent(
  deps: ScheduleDeps,
  dateKey: string,
  eventId: ScheduleEventId,
  newStartMin: number,
  now: number,
): Promise<ScheduleEvent> {
  const events = await listDayEvents(deps, dateKey);
  const event = events.find((item) => item.id === eventId);
  if (event === undefined) throw new Error("日程不存在（可能已被删除）");

  // 移动语义：时长恒定，整体平移；拖出边界时整块 clamp 回当天
  const duration = event.endMin - event.startMin;
  const maxStart = Math.max(0, DAY_TOTAL_MIN - duration);
  const startMin = Math.min(Math.max(snapDown(newStartMin), 0), maxStart);
  const endMin = startMin + duration;
  assertNoOverlap(events, { id: event.id, startMin, endMin });

  const next: ScheduleEvent = { ...event, startMin, endMin, updatedAt: now };
  await deps.database.scheduleEvents.put(next);
  return next;
}

/** 底缘拖拽调时长：改结束时间，最短 1 分钟 */
export async function resizeEvent(
  deps: ScheduleDeps,
  dateKey: string,
  eventId: ScheduleEventId,
  newEndMin: number,
  now: number,
): Promise<ScheduleEvent> {
  const events = await listDayEvents(deps, dateKey);
  const event = events.find((item) => item.id === eventId);
  if (event === undefined) throw new Error("日程不存在（可能已被删除）");

  const end = Math.max(newEndMin, event.startMin + MIN_DURATION_MIN);
  const { startMin, endMin } = clampSpan(event.startMin, end);
  assertNoOverlap(events, { id: event.id, startMin, endMin });

  const next: ScheduleEvent = { ...event, startMin, endMin, updatedAt: now };
  await deps.database.scheduleEvents.put(next);
  return next;
}

/** 编辑标题 / 备注 */
export async function updateEventDetails(
  deps: ScheduleDeps,
  dateKey: string,
  eventId: ScheduleEventId,
  draft: { title?: string | undefined; note?: string | undefined; startMin?: number; endMin?: number },
  now: number,
): Promise<ScheduleEvent> {
  const events = await listDayEvents(deps, dateKey);
  const event = events.find((item) => item.id === eventId);
  if (event === undefined) throw new Error("日程不存在（可能已被删除）");

  const title = draft.title?.trim();
  if (title !== undefined && title.length === 0)
    throw new Error("日程标题不能为空");
  const note = draft.note?.trim();
  const startMin = draft.startMin ?? event.startMin, endMin = draft.endMin ?? event.endMin;
  if (!validTimeSpan(startMin, endMin)) throw new Error('请输入当天有效的起止时间，结束须晚于开始');
  assertNoOverlap(events, { id: event.id, startMin, endMin });

  const next: ScheduleEvent = {
    ...event,
    startMin, endMin,
    ...(title !== undefined ? { title } : {}),
    ...(note !== undefined && note.length > 0 ? { note } : { note: undefined }),
    updatedAt: now,
  };
  await deps.database.scheduleEvents.put(next);
  return next;
}

/** 勾选完成（纯本表；与任务的联动由调用方按 docs/08 §3 组合） */
export async function setEventDone(
  deps: ScheduleDeps,
  dateKey: string,
  eventId: ScheduleEventId,
  done: boolean,
  now: number,
): Promise<ScheduleEvent> {
  const events = await listDayEvents(deps, dateKey);
  const event = events.find((item) => item.id === eventId);
  if (event === undefined) throw new Error("日程不存在（可能已被删除）");

  const next: ScheduleEvent = { ...event, done, updatedAt: now };
  await deps.database.scheduleEvents.put(next);
  return next;
}

/** 删除日程（硬删除 —— 日程没有回收站语义，删除前 UI 必须确认） */
export function removeEvent(
  deps: ScheduleDeps,
  eventId: ScheduleEventId,
): Promise<void> {
  return deps.database.scheduleEvents.delete(eventId);
}

/* ── 自然语言批量创建 ── */

export interface BatchCreateReport {
  created: ScheduleEvent[];
  /** 与已有日程（或本批已建条目）重叠而被拒绝的项 */
  rejected: Array<{ title: string; reason: string }>;
}

/**
 * 一句话建多条日程（docs/08 §AI-1）。
 *
 * 策略：**部分成功**而非全有全无 —— "6点到7点背单词，7点半到9点复习数学"
 * 若第二条与已有日程冲突，第一条照常创建（用户的表达是两条独立意图），
 * 拒绝项逐条报告原因。文本解析本身无时间词时抛错（调用方反问）。
 */
export async function createEventsFromText(
  deps: ScheduleDeps,
  dateKey: string,
  text: string,
  now: number,
): Promise<BatchCreateReport> {
  const parsed = parseScheduleText(text);
  if (parsed.items.length === 0) {
    const reason =
      parsed.error === "no-time"
        ? '没有识别到时间段。请带上起止时间，例如"6点到7点背单词"'
        : parsed.error === "bad-order"
          ? '有的时间段结束早于开始（比如"晚上11点半到12点"这类说法我理解不了），请换一种表达'
          : '时间说法没能解析清楚，请用"6点""6点半""6:45"这类写法';
    throw new Error(reason);
  }

  const report: BatchCreateReport = { created: [], rejected: [] };
  for (const item of parsed.items) {
    try {
      const created = await createEvent(
        deps,
        dateKey,
        { title: item.title, startMin: item.startMin, endMin: item.endMin },
        now,
      );
      report.created.push(created);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "创建失败";
      report.rejected.push({ title: item.title, reason: message });
    }
  }
  return report;
}
