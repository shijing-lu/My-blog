/**
 * 倒计时用例层（docs/10-倒计时.md）
 * ---------------------------------------------------------------------------
 * 职责边界：只操作 countdowns 这一张表，不读系统时间（now 由调用方注入），
 * 跨切片联动（如"归零后提醒"）由调用方组合 —— 与全站同一条纪律。
 *
 * 全部调节动作都是**对目标时刻的确定性运算**，不引入"剩余量"这个第二真相：
 *   - 续时 / 减少：targetAt ± 单位毫秒（暂停中则改剩余快照）
 *   - 暂停：把剩余快照下来；恢复：targetAt = now + 快照
 *   - 重设：targetAt = now + 新时长，清掉暂停与结束态
 */

import type { Countdown, CountdownUnit } from "@/cadence/entities/countdown";
import {
  durationMsOf,
  isPaused,
  nextColorOf,
  remainingMsOf,
  UNIT_MS,
} from "@/cadence/entities/countdown";
import type { CadenceDatabase } from "@/cadence/data/db/database";
import { DexieSoftDeleteRepo } from "@/cadence/data/repo/dexie-repos";
import type { SoftDeleteRepository } from "@/cadence/data/repo/types";
import { newEntityId } from "@/cadence/shared/model/entity";

export interface CountdownDeps {
  countdowns: SoftDeleteRepository<Countdown>;
}

export function createCountdownDeps(database: CadenceDatabase): CountdownDeps {
  return {
    countdowns: new DexieSoftDeleteRepo<Countdown>(
      database,
      database.countdowns,
    ),
  };
}

const MAX_NAME = 40;

/** 全部未删除的倒计时，按 order 升序（用户可预期的手工顺序） */
export async function listCountdowns(
  deps: CountdownDeps,
): Promise<Countdown[]> {
  const rows = await deps.countdowns.list();
  return rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export interface CountdownDraft {
  name: string;
  /** 时长模式的量（日历模式可不填，由 targetAt 接管） */
  amount: number;
  unit: CountdownUnit;
  /**
   * 日历模式：直接给定目标时刻（UTC ms）。
   * 给了就以它为准（须晚于 now）；没给则按 now + amount × unit 计算。
   */
  targetAt?: number | undefined;
}

/**
 * 解析草稿的目标时刻 —— 两种输入模式（时长 / 日历日期钟点）的唯一收口。
 * 返回 undefined = 输入不合法，由调用方抛错，不静默降级。
 */
function resolveTargetAt(
  draft: CountdownDraft,
  now: number,
): number | undefined {
  if (draft.targetAt !== undefined) {
    if (!Number.isFinite(draft.targetAt) || draft.targetAt <= now)
      return undefined;
    return Math.round(draft.targetAt);
  }
  const duration = durationMsOf(draft.amount, draft.unit);
  return duration === undefined ? undefined : now + duration;
}

/** 新建：目标时刻 = targetAt（日历模式）或 now + 数量 × 单位（时长模式） */
export async function createCountdown(
  deps: CountdownDeps,
  draft: CountdownDraft,
  now: number,
): Promise<Countdown> {
  const name = draft.name.trim();
  if (name.length === 0) throw new Error('倒计时需要名字，比如"考研"');
  if (name.length > MAX_NAME) throw new Error(`名字最长 ${MAX_NAME} 个字`);
  const targetAt = resolveTargetAt(draft, now);
  if (targetAt === undefined) {
    throw new Error(
      draft.targetAt !== undefined ? "目标时间要晚于现在" : "时长要大于 0",
    );
  }

  const existing = await listCountdowns(deps);
  const countdown: Countdown = {
    id: newEntityId("cd", now),
    name,
    unit: draft.unit,
    targetAt,
    color: nextColorOf(existing),
    order: existing.length,
    deletedAt: 0,
    createdAt: now,
    updatedAt: now,
  };
  await deps.countdowns.put(countdown, now);
  return countdown;
}

/**
 * 续时 / 缩短：按该倒计时的单位（或其原始设置单位）增减。
 * 暂停中调整的是剩余快照 —— 否则"暂停了还能被加时"会显得行为不一致。
 */
export async function adjustCountdown(
  deps: CountdownDeps,
  countdown: Countdown,
  steps: number,
  now: number,
): Promise<Countdown> {
  if (!Number.isFinite(steps) || steps === 0)
    throw new Error("调节量要是非零数字");
  const delta = Math.round(steps * UNIT_MS[countdown.unit]);
  const next = await loadById(deps, countdown.id);

  const updated: Countdown =
    next.pausedRemainingMs !== undefined
      ? {
          ...next,
          pausedRemainingMs: Math.max(0, next.pausedRemainingMs + delta),
          updatedAt: now,
        }
      : {
          ...next,
          targetAt: Math.max(now, next.targetAt + delta),
          updatedAt: now,
        };

  await deps.countdowns.put(updated, now);
  return updated;
}

/** 暂停：把当前剩余快照下来（幂等：已暂停时不动） */
export async function pauseCountdown(
  deps: CountdownDeps,
  countdown: Countdown,
  now: number,
): Promise<Countdown> {
  const current = await loadById(deps, countdown.id);
  if (isPaused(current)) return current;
  const updated: Countdown = {
    ...current,
    pausedRemainingMs: remainingMsOf(current, now),
    updatedAt: now,
  };
  await deps.countdowns.put(updated, now);
  return updated;
}

/** 恢复：targetAt 从现在起重新起算剩余快照（暂停期间的时间不计入） */
export async function resumeCountdown(
  deps: CountdownDeps,
  countdown: Countdown,
  now: number,
): Promise<Countdown> {
  const current = await loadById(deps, countdown.id);
  if (!isPaused(current)) return current;
  const remaining = current.pausedRemainingMs ?? 0;
  const updated: Countdown = {
    ...current,
    pausedRemainingMs: undefined,
    targetAt: now + remaining,
    updatedAt: now,
  };
  await deps.countdowns.put(updated, now);
  return updated;
}

/** 重设：清掉暂停态，按新的数量与单位（或直接给定的目标时刻）重算 */
export async function resetCountdown(
  deps: CountdownDeps,
  countdown: Countdown,
  draft: {
    amount: number;
    unit: CountdownUnit;
    name?: string | undefined;
    targetAt?: number | undefined;
  },
  now: number,
): Promise<Countdown> {
  const targetAt = resolveTargetAt(
    {
      name: "",
      amount: draft.amount,
      unit: draft.unit,
      targetAt: draft.targetAt,
    },
    now,
  );
  if (targetAt === undefined) {
    throw new Error(
      draft.targetAt !== undefined ? "目标时间要晚于现在" : "时长要大于 0",
    );
  }
  const name = draft.name?.trim();
  if (name !== undefined && name.length === 0) throw new Error("名字不能为空");
  const current = await loadById(deps, countdown.id);

  const updated: Countdown = {
    ...current,
    ...(name !== undefined ? { name } : {}),
    unit: draft.unit,
    targetAt,
    pausedRemainingMs: undefined,
    updatedAt: now,
  };
  await deps.countdowns.put(updated, now);
  return updated;
}

/** 改名（不动时间） */
export async function renameCountdown(
  deps: CountdownDeps,
  countdown: Countdown,
  name: string,
  now: number,
): Promise<Countdown> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("名字不能为空");
  if (trimmed.length > MAX_NAME) throw new Error(`名字最长 ${MAX_NAME} 个字`);
  const current = await loadById(deps, countdown.id);
  const updated: Countdown = { ...current, name: trimmed, updatedAt: now };
  await deps.countdowns.put(updated, now);
  return updated;
}

/** 删除（软删除，回收站 30 天内可恢复） */
export async function removeCountdown(
  deps: CountdownDeps,
  id: string,
  now: number,
): Promise<void> {
  await deps.countdowns.softDelete(id, now);
}

/** 取最新记录（UI 传进来的可能是上一帧的旧对象） */
async function loadById(deps: CountdownDeps, id: string): Promise<Countdown> {
  const row = await deps.countdowns.get(id);
  if (row === undefined) throw new Error("倒计时不存在（可能已被删除）");
  return row;
}
