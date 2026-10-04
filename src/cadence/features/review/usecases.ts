/**
 * 复盘用例层（M5）
 * ---------------------------------------------------------------------------
 * 周期格（Slot）不落库，由 deriveSlots 派生；这里只负责两件事：
 *   1. 周期配置的 CRUD（含"单日格数上限"这类配置合法性校验）
 *   2. 复盘条目的写入 / 编辑 / 软删除（唯一约束由 Dexie 复合索引兜底）
 *
 * 所有方法接收 now —— 与全站纪律一致：用例层不读系统时间，因此完全可测。
 */

import type { ReviewEntry, ReviewSchedule } from "@/cadence/entities/review";
import { MAX_SLOTS_PER_DAY } from "@/cadence/entities/review";
import { MOOD_MAX, MOOD_MIN, isMood } from "@/cadence/entities/review";
import type { CadenceDatabase } from "@/cadence/data/db/database";
import { DexieSoftDeleteRepo } from "@/cadence/data/repo/dexie-repos";
import type { SoftDeleteRepository } from "@/cadence/data/repo/types";
import { newEntityId } from "@/cadence/shared/model/entity";

export interface ReviewDeps {
  schedules: SoftDeleteRepository<ReviewSchedule>;
  entries: SoftDeleteRepository<ReviewEntry>;
}

export function createReviewDeps(database: CadenceDatabase): ReviewDeps {
  return {
    schedules: new DexieSoftDeleteRepo<ReviewSchedule>(
      database,
      database.reviewSchedules,
    ),
    entries: new DexieSoftDeleteRepo<ReviewEntry>(
      database,
      database.reviewEntries,
    ),
  };
}

/* ── 周期配置 ── */

export interface ScheduleDraft {
  title: string;
  /** 间隔小时数（0.25 起步） */
  intervalHours: number;
  /** 锚点时区当天 00:00 起的偏移毫秒（第一格的起点） */
  anchorOffsetMs: number;
  prompt?: string | undefined;
}

/** 新建周期配置。配置不合法直接抛错（提示语即用户能看懂的话） */
export async function createSchedule(
  deps: ReviewDeps,
  draft: ScheduleDraft,
  now: number,
): Promise<ReviewSchedule> {
  assertScheduleDraft(draft);

  const schedule: ReviewSchedule = {
    id: newEntityId("rev-sch", now),
    title: draft.title,
    intervalHours: draft.intervalHours,
    anchorOffsetMs: draft.anchorOffsetMs,
    enabled: true,
    order: now, // 用创建时间当顺序：新配置永远排最后，不需要单独维护 order 字段
    ...(draft.prompt && draft.prompt.length > 0
      ? { prompt: draft.prompt }
      : {}),
    deletedAt: 0,
    createdAt: now,
    updatedAt: now,
  };
  return deps.schedules.put(schedule, now);
}

export async function updateScheduleDetails(
  deps: ReviewDeps,
  schedule: ReviewSchedule,
  draft: ScheduleDraft,
  now: number,
): Promise<ReviewSchedule> {
  assertScheduleDraft(draft);
  return deps.schedules.put(
    {
      ...schedule,
      title: draft.title,
      intervalHours: draft.intervalHours,
      anchorOffsetMs: draft.anchorOffsetMs,
      ...(draft.prompt && draft.prompt.length > 0
        ? { prompt: draft.prompt }
        : { prompt: undefined }),
      updatedAt: now,
    },
    now,
  );
}

/** 删除周期：历史条目保留（孤立条目可在 M6 的"重挂"里找回） */
export function deleteSchedule(
  deps: ReviewDeps,
  id: string,
  now: number,
): Promise<void> {
  return deps.schedules.softDelete(id, now);
}

function assertScheduleDraft(draft: ScheduleDraft): void {
  if (draft.title.trim().length === 0) throw new Error("周期名称不能为空");
  if (!(draft.intervalHours > 0)) throw new Error("间隔必须大于 0 小时");

  const slotsPerDay = Math.ceil(24 / draft.intervalHours);
  if (!Number.isFinite(slotsPerDay) || slotsPerDay > MAX_SLOTS_PER_DAY) {
    throw new Error(
      `间隔太小：一天会派生 ${slotsPerDay} 个格子（上限 ${MAX_SLOTS_PER_DAY}）`,
    );
  }
  if (draft.anchorOffsetMs < 0 || draft.anchorOffsetMs >= 86_400_000) {
    throw new Error("锚点偏移必须在一天之内");
  }
}

/* ── 复盘条目 ── */

export interface EntryDraft {
  content: string;
  mood?: number | undefined;
}

/**
 * 写入 / 更新某格子的复盘。
 * 同一格子重复写入 = 覆盖编辑（唯一约束 [scheduleId+slotStart] 保证不会出现两条）。
 */
export async function upsertEntry(
  deps: ReviewDeps,
  schedule: ReviewSchedule,
  slotStart: number,
  dateKey: string,
  draft: EntryDraft,
  now: number,
): Promise<ReviewEntry> {
  const content = draft.content.trim();
  if (content.length === 0) throw new Error("复盘内容不能为空");
  if (draft.mood !== undefined && !isMood(draft.mood)) {
    throw new Error(`心情必须是 ${MOOD_MIN}–${MOOD_MAX} 的整数`);
  }

  // 同格已有条目则编辑它（保 id / createdAt），否则新建
  const existing = await Promise.all([
    deps.entries.list(),
    deps.entries.listTrash(),
  ]).then((groups) =>
    groups
      .flat()
      .find(
        (entry) =>
          entry.scheduleId === schedule.id && entry.slotStart === slotStart,
      ),
  );

  return deps.entries.put(
    {
      id: existing?.id ?? `rev-entry:${schedule.id}:${slotStart}`,
      scheduleId: schedule.id,
      slotStart,
      dateKey,
      content,
      tags: existing?.tags ?? [],
      // exactOptionalPropertyTypes：未标记心情时直接缺省字段，而不是显式 undefined
      ...(draft.mood !== undefined ? { mood: draft.mood } : {}),
      deletedAt: 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
    now,
  );
}

export function deleteEntry(
  deps: ReviewDeps,
  id: string,
  now: number,
): Promise<void> {
  return deps.entries.softDelete(id, now);
}
