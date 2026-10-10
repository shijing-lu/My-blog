/**
 * 总览 Dashboard
 * ---------------------------------------------------------------------------
 * M7 接入真实数据。视觉语言沿用 M0 定稿（便签 / 水彩晕染 / 手绘线），
 * 所有数字来自数据库实时查询 —— 没有任何示意值。
 *
 * 口径说明：
 *   今日投入 = 今日已结束会话的时长和（进行中的不进统计，见 Session 注释）；
 *   复盘完成 = 今日已有条目的格子 / 当天相交的格子总数；
 *   待办分布 = countByZone（坐标 + 分区规则派生，不落库）。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import {
  isSessionActive,
  sessionDurationMs,
  type Session,
} from "@/cadence/entities/session";
import type { AxisConfig } from "@/cadence/entities/axis";
import { deriveSlots } from "@/cadence/entities/review";
import { db } from "@/cadence/data/db/database";
import {
  dateKeyOf,
  endOfDayMs,
  startOfDayMs,
  localTzOffsetMinutes,
  DAY_MS,
} from "@/cadence/shared/db/time";
import { HandRule, PresenceDialog, StickyNoteStatic } from "@/cadence/shared/motion";
import { countByZone } from "@/cadence/features/stats";
import { createTodo, createTodoDeps } from "@/cadence/features/todos";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { TextField } from "@/cadence/shared/ui/TextField";
import { TodayScheduleCard } from "./ui/TodayScheduleCard";

import { TodayPlanCard } from "./ui/TodayPlanCard";
import { CountdownHero } from "./ui/CountdownHero";

const SLOT_FILL = {
  done: "var(--color-fabric-base)",
  pending: "transparent",
  future: "transparent",
} as const;

export function DashboardPage() {
  const tz = useMemo(() => localTzOffsetMinutes(), []);
  const now = Date.now();
  const todayKey = dateKeyOf(now, tz);
  const dayFrom = startOfDayMs(todayKey, tz);
  const dayTo = endOfDayMs(todayKey, tz);

  // 双击便签墙 → 就地新建待办（类型 = 象限）
  const todoDeps = useMemo(() => createTodoDeps(db), []);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [quadrant, setQuadrant] = useState("zone-plan");

  const todaySessions = useLiveQuery(
    () =>
      db.sessions
        .where("startedAt")
        .between(dayFrom - DAY_MS, dayTo)
        .toArray(),
    [dayFrom, dayTo],
  );
  const plans = useLiveQuery(
    () => db.plans.where("deletedAt").equals(0).toArray(),
    [],
  );
  const todos = useLiveQuery(
    () => db.todos.where("deletedAt").equals(0).toArray(),
    [],
  );
  const axis = useLiveQuery(async (): Promise<AxisConfig | undefined> => {
    const all = await db.axisConfigs.toArray();
    return all.find((item) => item.isDefault) ?? all[0];
  }, []);
  const schedule = useLiveQuery(async () => {
    const all = await db.reviewSchedules.where("deletedAt").equals(0).toArray();
    return all
      .filter((item) => item.enabled)
      .sort((a, b) => a.order - b.order)[0];
  }, []);
  const entries = useLiveQuery(
    () => db.reviewEntries.where("deletedAt").equals(0).toArray(),
    [],
  );

  /* ── 派生（全部 useMemo，查询返回 undefined 时安静降级为 0） ── */

  const sessions = useMemo(
    () =>
      (todaySessions ?? []).filter(
        (s) => s.startedAt >= dayFrom && s.startedAt < dayTo,
      ),
    [todaySessions, dayFrom, dayTo],
  );
  const finished = useMemo(
    () => sessions.filter((s) => !isSessionActive(s)),
    [sessions],
  );
  const todayMs = useMemo(
    () => finished.reduce((sum, s) => sum + sessionDurationMs(s, now), 0),
    [finished, now],
  );
  const yesterdayMs = useMemo(() => {
    const yFrom = dayFrom - DAY_MS;
    const list = (todaySessions ?? []).filter(
      (s: Session) =>
        !isSessionActive(s) && s.startedAt >= yFrom && s.startedAt < dayFrom,
    );
    return list.reduce((sum, s) => sum + sessionDurationMs(s, now), 0);
  }, [todaySessions, dayFrom, now]);
  const deltaPct =
    yesterdayMs > 0
      ? Math.round(((todayMs - yesterdayMs) / yesterdayMs) * 100)
      : undefined;

  const activePlans = useMemo(
    () => (plans ?? []).filter((p) => p.status === "active").length,
    [plans],
  );
  const todoCount = useMemo(
    () => (todos ?? []).filter((t) => t.status !== "done").length,
    [todos],
  );

  const reviewedToday = useMemo(() => {
    if (!schedule) return 0;
    const starts = new Set(
      deriveSlots(schedule, todayKey, tz).map((slot) => slot.start),
    );
    return (entries ?? []).filter(
      (e) => e.scheduleId === schedule.id && starts.has(e.slotStart),
    ).length;
  }, [entries, schedule, todayKey, tz]);
  const slotsToday = useMemo(
    () => (schedule !== undefined ? deriveSlots(schedule, todayKey, tz) : []),
    [schedule, todayKey, tz],
  );

  const zoneCounts = useMemo(() => {
    if (axis === undefined) return undefined;
    return countByZone(
      axis,
      (todos ?? []).filter((todo) => todo.axisConfigId === axis.id),
    );
  }, [axis, todos]);

  const recentTodos = useMemo(
    () => (todos ?? []).filter((t) => t.status !== "done").slice(0, 5),
    [todos],
  );

  const confirmCreate = () => {
    const title = draftTitle.trim();
    if (title.length === 0) return;
    // 乐观关闭；坐标 = 所选象限中心（与看板坐标系一致，落库前还有 clamp 兜底）
    setCreating(false);
    setDraftTitle("");
    const region =
      axis?.regions.find((r) => r.id === quadrant) ?? axis?.regions[0];
    const coordinate = region
      ? { x: (region.x0 + region.x1) / 2, y: (region.y0 + region.y1) / 2 }
      : { x: 25, y: 75 };
    void createTodo(todoDeps, { title, coordinate }, Date.now()).then(() =>
      toast.success(`已记下「${title}」`),
    );
  };

  return (
    <div className="cadence-overview space-y-4">
      <header className="neo-schedule-section-title flex items-baseline gap-3">
        <p className="text-ink-3 text-[11px] tracking-[0.22em] uppercase">
          Today
        </p>
        <h2 className="text-xl">今天</h2>
      </header>

      <div className="cadence-overview-grid">
        <CountdownHero />
        <TodayPlanCard dateKey={todayKey} />
        <TodayScheduleCard dateKey={todayKey} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* ── 便签：今日投入 ── */}
        <div className="relative">
          <span className="watercolor-blot h-52 w-64 -top-10 -left-12 bg-[radial-gradient(closest-side,var(--color-amber-soft),transparent)]" />
          <span className="watercolor-blot h-40 w-40 -right-6 -bottom-8 bg-[radial-gradient(closest-side,var(--color-clay-soft),transparent)]" />

          <div
            className="neo-schedule-investment relative bg-amber-soft px-5 pt-5 pb-6"
            style={{
              borderRadius: "var(--radius-hand-md)",
              transform: "none",
              boxShadow:
                "0 1px 2px -1px var(--paper-shadow), 0 8px 18px -12px var(--paper-shadow)",
            }}
          >
            <p className="text-ink-3 text-[11px] tracking-[0.14em]">
              今日已投入
            </p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="numeric text-amber-deep text-[38px] leading-none">
                {(todayMs / 3_600_000).toFixed(1)}
              </span>
              <span className="text-ink-2 font-serif text-[13px]">小时</span>
              {deltaPct !== undefined && finished.length > 0 ? (
                <span
                  className={[
                    "ml-auto rounded-[var(--radius-hand-sm)] px-2.5 py-1 text-[11.5px]",
                    deltaPct >= 0
                      ? "bg-forest-soft text-forest-deep"
                      : "bg-clay-soft text-clay-deep",
                  ].join(" ")}
                >
                  较昨日 {deltaPct >= 0 ? "+" : ""}
                  {deltaPct}%
                </span>
              ) : null}
            </div>
            <HandRule shape="ripple" className="my-3.5" />
            <dl className="grid grid-cols-2 gap-y-3.5 sm:grid-cols-4">
              {[
                { k: `${activePlans}`, v: "活跃计划" },
                { k: `${todoCount}`, v: "待办在册" },
                {
                  k:
                    slotsToday.length > 0
                      ? `${reviewedToday} / ${slotsToday.length}`
                      : "—",
                  v: "复盘完成",
                },
                { k: `${finished.length}`, v: "专注段数" },
              ].map((s) => (
                <div key={s.v}>
                  <dd className="numeric text-ink-1 font-serif text-[19px]">
                    {s.k}
                  </dd>
                  <dt className="text-ink-3 text-[11.5px]">{s.v}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* ── 复盘时间轴（第一个启用周期，无则引导） ── */}
        <section className="surface-card p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px]">复盘时间轴</h3>
            {schedule !== undefined ? (
              <span className="text-ink-3 numeric text-[11px]">
                {schedule.title} · 每 {schedule.intervalHours} 小时
              </span>
            ) : null}
          </div>

          {schedule === undefined || slotsToday.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-ink-3 text-[12.5px]">还没有复盘周期。</p>
              <Link
                to="/review"
                className="text-amber-deep craft-transition-fast mt-2 inline-block text-[12.5px] underline underline-offset-4"
              >
                去建一个 →
              </Link>
            </div>
          ) : (
            <>
              <div className="surface-inset mt-3.5 flex h-14 overflow-hidden">
                {slotsToday.map((slot) => {
                  const hasEntry = (entries ?? []).some(
                    (e) =>
                      e.scheduleId === schedule.id &&
                      e.slotStart === slot.start,
                  );
                  const state = hasEntry
                    ? "done"
                    : slot.end <= now
                      ? "pending"
                      : "future";
                  return (
                    <div
                      key={slot.start}
                      className="border-paper-line relative flex flex-1 items-center justify-center border-r border-dashed last:border-r-0"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-[5px_3px] rounded-[var(--radius-hand-sm)]"
                        style={{
                          background: SLOT_FILL[state],
                          boxShadow:
                            state === "pending"
                              ? "inset 0 0 0 1.5px var(--color-amber-base)"
                              : state === "future"
                                ? "inset 0 0 0 1.5px var(--color-paper-line)"
                                : "none",
                        }}
                      />
                      <span className="bg-paper-1/80 numeric relative z-10 rounded px-1 text-[10px] text-ink-2">
                        {new Date(slot.start).getHours()}–
                        {new Date(slot.end).getHours()}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-ink-3 mt-3.5 text-[11.5px]">
                格子由配置派生（不落库）。虚线框 = 到点待复盘。
              </p>
            </>
          )}
        </section>

        {/* ── 待办象限缩略图 ── */}
        <section className="surface-card p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px]">待办分布</h3>
            <span className="text-ink-3 text-[11px]">
              {axis?.name ?? "XY 双轴"}
            </span>
          </div>
          <HandRule shape="gentle" className="mt-3" />
          {zoneCounts === undefined ? (
            <p className="text-ink-4 py-6 text-center text-[12px]">
              数据层初始化中…
            </p>
          ) : (
            <ul className="mt-3.5 grid grid-cols-2 gap-2.5">
              {(axis?.regions ?? []).map((region) => {
                const zoneId = region.id;
                const display = {
                  label: region.label,
                  soft: "bg-muted",
                  text: "text-foreground",
                };
                const count = zoneCounts.get(zoneId)?.count ?? 0;
                return (
                  <li
                    key={zoneId}
                    className={[
                      "rounded-[var(--radius-hand-sm)] p-3",
                      display.soft,
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "numeric font-serif text-[22px]",
                        display.text,
                      ].join(" ")}
                    >
                      {count}
                    </span>
                    <span
                      className={[
                        "mt-0.5 block text-[11px]",
                        display.text,
                      ].join(" ")}
                    >
                      {display.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── 便捷入口 ── */}
        <section className="surface-card p-5">
          <h3 className="text-[15px]">快捷入口</h3>
          <HandRule shape="gentle" className="mt-3" />
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/execute"
              className="craft-transition-fast rounded-[var(--radius-hand-pill)] bg-amber-deep px-5 py-2.5 text-sm text-paper-base hover:bg-amber-base"
            >
              开始计时
            </Link>
            <Link
              to="/review"
              className="hand-frame craft-transition-fast px-5 py-2.5 text-sm text-ink-1 hover:text-ink-3"
            >
              去复盘
            </Link>
            <Link
              to="/todos"
              className="hand-frame craft-transition-fast px-5 py-2.5 text-sm text-ink-1 hover:text-ink-3"
            >
              待办看板
            </Link>
          </div>
        </section>
      </div>

      {/* ── 便签墙：最近的未完成待办（双击空白处 → 就地新建） ── */}
      <section
        className="surface-card p-5"
        onDoubleClick={() => setCreating(true)}
        data-testid="sticky-wall"
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px]">待办便签</h3>
          <span className="text-ink-3 text-[11px]">双击这里可新建待办</span>
        </div>
        <HandRule shape="wave" className="mt-3" />
        {recentTodos.length === 0 ? (
          <p className="text-ink-4 py-5 text-center text-[12.5px]">
            没有进行中的待办。{" "}
            <span className="text-amber-deep underline underline-offset-4">
              双击这里
            </span>{" "}
            记一条，或去{" "}
            <Link
              to="/todos"
              className="text-amber-deep underline underline-offset-4"
            >
              待办看板
            </Link>
            。
          </p>
        ) : (
          <div className="mt-5 flex flex-wrap gap-4">
            {recentTodos.map((todo) => (
              <StickyNoteStatic
                key={todo.id}
                id={todo.id}
                tone={todo.status === "done" ? "done" : "plan"}
              >
                {todo.title}
              </StickyNoteStatic>
            ))}
          </div>
        )}
      </section>

      {/* 双击新建：标题 + 象限类型（坐标取象限中心，落点与看板拖拽同一坐标系） */}
      <PresenceDialog open={creating} onOpenChange={setCreating} title="记一条待办">
            <HandRule shape="gentle" className="my-3" />
            <TextField
              label="待办内容"
              value={draftTitle}
              placeholder="一句话说清要做什么"
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmCreate();
                }
              }}
            />
            <fieldset className="mt-4">
              <legend className="text-ink-3 mb-2 text-[11.5px]">
                分区（之后可拖拽调整）
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(axis?.regions ?? []).map((region) => {
                  const name = region.id;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={quadrant === name}
                      onClick={() => setQuadrant(name)}
                      className={[
                        "craft-transition-fast rounded-[var(--radius-hand-sm)] px-3 py-2 text-[12.5px]",
                        quadrant === name
                          ? "bg-amber-soft text-amber-deep shadow-[inset_0_0_0_1.5px_var(--color-amber-base)]"
                          : "surface-inset text-ink-2 hover:text-ink-1",
                      ].join(" ")}
                    >
                      {region.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreating(false)}
              >
                取消
              </Button>
              <Button size="sm" onClick={confirmCreate}>
                记下
              </Button>
            </div>
      </PresenceDialog>
    </div>
  );
}
