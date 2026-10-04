/**
 * 执行页（M6）
 * ---------------------------------------------------------------------------
 * 一段专注 = Session（startedAt + endedAt，进行中时 endedAt 缺省）。
 * 页面职责很薄：开始 / 结束按钮 + 今日记录列表。派生与统计都不在这里。
 *
 * 进行中时长的显示走 1s 心跳重渲染 —— 只影响这一个小数字，
 * 不触碰任何列表数据（它们都在 useLiveQuery 里，心跳不会引发重新查询）。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";

import type { Session } from "@/cadence/entities/session";
import { isSessionActive, sessionDurationMs } from "@/cadence/entities/session";
import { deriveSlots, slotOf } from "@/cadence/entities/review";
import { db } from "@/cadence/data/db/database";
import {
  clockOf,
  formatDuration,
  dateKeyOf,
  localTzOffsetMinutes,
  startOfDayMs,
  endOfDayMs,
} from "@/cadence/shared/db/time";
import { AnimatePresence, HandRule, m } from "@/cadence/shared/motion";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { Card } from "@/cadence/shared/ui/Card";
import { PageHeader } from "@/cadence/shared/ui/PageHeader";
import { TextField } from "@/cadence/shared/ui/TextField";
import {
  createSessionDeps,
  startSession,
  stopSession,
  toggleSessionPause,
  recordManualSession,
} from "@/cadence/features/execute";
import {
  createReviewDeps,
  deleteEntry,
  EntryEditor,
  upsertEntry,
  type EditingTarget,
} from "@/cadence/features/review";

export function ExecutePage() {
  const deps = useMemo(() => createSessionDeps(db), []);
  const reviewDeps = useMemo(() => createReviewDeps(db), []);
  const tz = useMemo(() => localTzOffsetMinutes(), []);

  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [starting, setStarting] = useState(false);
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [manualNote, setManualNote] = useState("");
  /** 专注结束后自动弹出的复盘编辑目标（与复盘页共用同一编辑器） */
  const [reviewTarget, setReviewTarget] = useState<EditingTarget | undefined>(
    undefined,
  );

  // 进行中的专注。⚠️ 查询范围必须用确定性的日期边界（今天的 0 点 ± 48h），
  // 不能用 Date.now() 现算 —— Dexie liveQuery 只观察"首次执行时"的键区间，
  // 用 now 现算的区间会把几秒后写入的记录漏在观察范围外（变更静默丢失）。
  const active = useLiveQuery(async () => {
    const list = await db.sessions.toArray();
    return list.find(isSessionActive);
  }, [deps, tz]);
  useEffect(() => {
    if (active === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const todayRange = useMemo(() => {
    const key = dateKeyOf(now, tz);
    return { from: startOfDayMs(key, tz), to: endOfDayMs(key, tz) };
  }, [now, tz]);
  const todaySessions = useLiveQuery(
    () => deps.sessions.inRange(todayRange.from, todayRange.to),
    [deps, todayRange.from, todayRange.to],
  );
  const sessions = useMemo(() => todaySessions ?? [], [todaySessions]);
  const totalMs = useMemo(
    () =>
      sessions
        .filter((session) => !isSessionActive(session))
        .reduce((sum, session) => sum + sessionDurationMs(session, now), 0),
    [sessions, now],
  );

  const onStart = () => {
    setStarting(true);
    void startSession(deps, { note }, Date.now())
      .then(() => setNote(""))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "无法开始"),
      )
      .finally(() => setStarting(false));
  };

  const onStop = (session: Session) => {
    const endedAt = Date.now();
    void stopSession(deps, session, endedAt)
      .then(async (stopped) => {
        toast.success("干得好，记下了");
        await openReviewFor(stopped, endedAt);
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "结束失败"),
      );
  };

  /**
   * 专注结束 → 自动弹出该时间段的复盘编辑器（与复盘页共用同一组件）。
   *
   * 时间段 → 格子的归口：用专注**起点**定位格子（slotOf 左闭右开）；
   * 起点意外落空（如恰在锚点缝隙）时退回用结束时间找。找不到格子
   * （没有启用中的周期 / 当天无覆盖格）则提示去复盘页，不静默丢弃。
   */
  const openReviewFor = async (session: Session, endedAt: number) => {
    const schedules = await reviewDeps.schedules.list();
    const schedule = schedules
      .filter((item) => item.enabled)
      .sort((a, b) => a.order - b.order)[0];
    if (schedule === undefined) {
      toast.info("想给这段专注写复盘？先到「复盘」页建一个周期");
      return;
    }

    const slots = deriveSlots(schedule, dateKeyOf(session.startedAt, tz), tz);
    const slot = slotOf(slots, session.startedAt) ?? slotOf(slots, endedAt);
    if (slot === undefined) {
      toast.info("这段时间不在任何复盘格子里，可到「复盘」页手动记录");
      return;
    }

    setReviewTarget({ schedule, slot });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Execute"
        title="执行"
        rule="ripple"
        description="记录真实发生的时间：开始一段专注，结束时自动落库。时长由时间戳计算，标签页被节流也不影响精度。"
      />

      {/* 计时器 */}
      <Card className="text-center">
        <AnimatePresence mode="wait">
          {active !== undefined ? (
            <m.div
              key="active"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="text-ink-3 text-[11.5px] tracking-[0.2em]">
                {active.pausedAt === undefined ? "专注中" : "已暂停"}
              </p>
              <p className="text-ink-1 numeric font-serif my-2 text-[44px] leading-none">
                {formatDuration(sessionDurationMs(active, now))}
              </p>
              {active.note !== undefined ? (
                <p className="text-ink-2 text-[13px]">{active.note}</p>
              ) : null}
              <HandRule shape="wave" className="mx-auto my-4 max-w-32" />
              <div className="flex justify-center gap-3">
                <Button
                  variant="ghost"
                  onClick={() =>
                    void toggleSessionPause(deps, active, Date.now()).catch(
                      (e) => toast.error(e.message),
                    )
                  }
                >
                  {active.pausedAt === undefined ? "暂停" : "继续"}
                </Button>
                <Button onClick={() => onStop(active)}>结束这段专注</Button>
              </div>
            </m.div>
          ) : (
            <m.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="text-ink-3 text-[11.5px] tracking-[0.2em]">
                准备投入
              </p>
              <p className="text-ink-4 numeric my-2 text-[13px]">
                今日累计 {formatDuration(totalMs)}
              </p>
              <div className="mx-auto mt-4 max-w-md">
                <TextField
                  label="在做什么（可选）"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="如：改第八稿的引言"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onStart();
                    }
                  }}
                />
              </div>
              <Button onClick={onStart} loading={starting} className="mt-2">
                开始专注
              </Button>
            </m.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 今日记录 */}
      <Card>
        <details>
          <summary className="cursor-pointer text-sm">补录执行记录</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextField
              type="datetime-local"
              label="开始时间"
              value={manualStart}
              onChange={(e) => setManualStart(e.target.value)}
            />
            <TextField
              type="datetime-local"
              label="结束时间"
              value={manualEnd}
              onChange={(e) => setManualEnd(e.target.value)}
            />
          </div>
          <div className="mt-4">
            <TextField
              label="事项备注"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
            />
          </div>
          <Button
            className="mt-3"
            size="sm"
            onClick={() =>
              void recordManualSession(
                deps,
                {
                  startedAt: new Date(manualStart).getTime(),
                  endedAt: new Date(manualEnd).getTime(),
                  note: manualNote,
                },
                Date.now(),
              )
                .then(() => {
                  setManualStart("");
                  setManualEnd("");
                  setManualNote("");
                  toast.success("已补录执行记录");
                  setNow(Date.now());
                })
                .catch((e) => toast.error(e.message))
            }
          >
            保存补录
          </Button>
        </details>
      </Card>
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-ink-1 font-serif text-[15px]">今天的记录</h3>
          <span className="text-ink-4 numeric text-[11.5px]">
            {sessions.length} 段 · 有效 {formatDuration(totalMs)}
          </span>
        </div>

        {sessions.length === 0 ? (
          <p className="text-ink-4 py-6 text-center text-[12.5px]">
            今天还没有记录。上面按下「开始专注」即可。
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="surface-inset flex flex-wrap items-center gap-3 rounded-[var(--radius-hand-sm)] px-4 py-2.5"
              >
                <span className="text-ink-3 numeric text-[11.5px]">
                  {clockOf(session.startedAt, tz)}
                  {session.endedAt !== undefined
                    ? ` – ${clockOf(session.endedAt, tz)}`
                    : " – 进行中"}
                </span>
                <span className="text-ink-1 flex-1 text-[13px]">
                  {session.note ?? (
                    <span className="text-ink-4">（未注明）</span>
                  )}
                </span>
                <span className="text-ink-2 numeric text-[12.5px]">
                  {formatDuration(sessionDurationMs(session, now))}
                </span>
                {isSessionActive(session) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onStop(session)}
                  >
                    结束
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 专注结束后的复盘弹窗（与复盘页共用编辑器；写入同一张表） */}
      <EntryEditor
        target={reviewTarget}
        onClose={() => setReviewTarget(undefined)}
        onSave={async (schedule, slot, draft, entryId) => {
          await upsertEntry(
            reviewDeps,
            schedule,
            slot.start,
            slot.dateKey,
            draft,
            Date.now(),
          );
          setReviewTarget(undefined);
          toast.success(entryId !== undefined ? "复盘已更新" : "已记入复盘");
        }}
        onDelete={async (entryId) => {
          await deleteEntry(reviewDeps, entryId, Date.now());
          setReviewTarget(undefined);
          toast.info("已删除，30 天内可在回收站恢复");
        }}
      />
    </div>
  );
}
