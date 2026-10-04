/**
 * 执行用例层（M5/M6）
 * ---------------------------------------------------------------------------
 * 执行会话 = 一段专注时间。开始即落库（endedAt 缺省 = 进行中），
 * 结束时补 endedAt。这样即使中途关浏览器，进行中的记录也能被
 * "孤儿会话"清理逻辑识别（超长进行中按异常处理，见 stats 口径）。
 *
 * 全部方法接收 now —— 用例层不读系统时间。
 */

import type { Session } from "@/cadence/entities/session";
import { isSessionActive } from "@/cadence/entities/session";
import type { CadenceDatabase } from "@/cadence/data/db/database";
import { DexieSessionRepo } from "@/cadence/data/repo/dexie-repos";
import { newEntityId } from "@/cadence/shared/model/entity";

export interface SessionDeps {
  sessions: DexieSessionRepo;
  database?: CadenceDatabase;
}

export function createSessionDeps(database: CadenceDatabase): SessionDeps {
  return { sessions: new DexieSessionRepo(database), database };
}

/** 开始一段专注。note 可选；planId/taskId 留空表示"临时投入" */
export async function startSession(
  deps: SessionDeps,
  input: {
    planId?: string | undefined;
    taskId?: string | undefined;
    note?: string | undefined;
  },
  now: number,
): Promise<Session> {
  if (deps.database)
    return deps.database.transaction("rw", deps.database.sessions, () =>
      startSession({ sessions: deps.sessions }, input, now),
    );
  // 同一时间只允许一段进行中的专注 —— 两段"进行中"会让统计口径出现分叉。
  // 粗筛近 24h（inRange 的语义），进行中的会话起点必然落在其中
  const recent = await deps.sessions.inRange(
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  const active = recent.find(isSessionActive);
  if (active !== undefined) {
    throw new Error("已有一段专注在进行中，请先结束它");
  }

  const session: Session = {
    id: newEntityId("sess", now),
    startedAt: now,
    ...(input.planId !== undefined ? { planId: input.planId } : {}),
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    ...(input.note !== undefined && input.note.length > 0
      ? { note: input.note }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
  return deps.sessions.put(session, now);
}

/** 结束一段专注。重复结束取最早的时刻（幂等且不缩水已记录时长） */
export async function stopSession(
  deps: SessionDeps,
  session: Session,
  now: number,
): Promise<Session> {
  if (deps.database)
    return deps.database.transaction("rw", deps.database.sessions, () =>
      stopSession({ sessions: deps.sessions }, session, now),
    );
  session = (await deps.sessions.get(session.id)) ?? session;
  if (!isSessionActive(session)) return session;
  const endedAt = Math.max(session.startedAt, now);
  const pausedMs =
    (session.pausedMs ?? 0) +
    (session.pausedAt === undefined
      ? 0
      : Math.max(0, endedAt - session.pausedAt));
  return deps.sessions.put(
    { ...session, endedAt, pausedMs, pausedAt: undefined, updatedAt: now },
    now,
  );
}

export async function toggleSessionPause(
  deps: SessionDeps,
  session: Session,
  now: number,
): Promise<Session> {
  if (deps.database)
    return deps.database.transaction("rw", deps.database.sessions, () =>
      toggleSessionPause({ sessions: deps.sessions }, session, now),
    );
  const latest = await deps.sessions.get(session.id);
  if (!latest || !isSessionActive(latest)) throw new Error("这段专注已经结束");
  const next =
    latest.pausedAt === undefined
      ? { ...latest, pausedAt: Math.max(now, latest.startedAt) }
      : {
          ...latest,
          pausedMs: (latest.pausedMs ?? 0) + Math.max(0, now - latest.pausedAt),
          pausedAt: undefined,
        };
  return deps.sessions.put(next, now);
}

export async function recordManualSession(
  deps: SessionDeps,
  input: { startedAt: number; endedAt: number; note?: string },
  now: number,
): Promise<Session> {
  if (
    !Number.isFinite(input.startedAt) ||
    !Number.isFinite(input.endedAt) ||
    input.startedAt >= input.endedAt
  )
    throw new Error("结束时间应晚于开始时间");
  if (input.endedAt > now) throw new Error("补录的结束时间不能在未来");
  if (input.endedAt - input.startedAt > 86400000)
    throw new Error("每段记录最多 24 小时，请分段补录");
  if (deps.database)
    return deps.database.transaction("rw", deps.database.sessions, () =>
      recordManualSession({ sessions: deps.sessions }, input, now),
    );
  const overlap = await deps.sessions.inRange(input.startedAt, input.endedAt);
  if (overlap.length) throw new Error("这段时间已有执行记录，请调整补录时间");
  return deps.sessions.put(
    { id: newEntityId("sess", now), ...input, createdAt: now, updatedAt: now },
    now,
  );
}

/** 丢弃一段进行中的专注（记错了/被打断且不值得留痕） */
export function discardSession(deps: SessionDeps, id: string): Promise<void> {
  return deps.sessions.purge(id);
}
