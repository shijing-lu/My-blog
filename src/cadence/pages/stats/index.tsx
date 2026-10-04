/**
 * 专注统计面板（docs/09-专注统计面板.md）
 * ---------------------------------------------------------------------------
 * 维度分析 → 图表选型（为什么是这几个）：
 *
 *   1. 「投入了多少」—— KPI 卡：今日 / 本周 / 日均 / 连续天数。
 *      回答"我最近有没有在状态"，一眼可比。
 *   2. 「趋势」—— 近 14 天柱状 + 日均虚线。周节奏（工作日多、周末塌）
 *      只有时间轴图能看出来；只给总量会掩盖波动。
 *   3. 「时间去哪了」—— 按计划占比甜甜圈 + 任务 Top5 条形。
 *      计划回答"账本层面"的分配，任务回答"具体在做什么"。
 *      再补一整行的「按名称聚合」条形：任务/计划/专注名按优先级取一个标签，
 *      回答"每件事花了我多少时间" —— 没挂任务、只在日程事件上记一笔的
 *      专注也收得进来，Top5 那种"看不见的长尾"在这里不再丢失。
 *   4. 「什么时段高效」—— 24 小时分布。个人节律（早起型/夜型）
 *      是安排日程的直接依据，和日程面板形成闭环。
 *   5. 「计划完成率」—— 活跃计划进度条。投入 × 完成对照，
 *      防止"很忙但没产出"的自欺。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

import type { Session } from "@/cadence/entities/session";
import { db } from "@/cadence/data/db/database";
import {
  dateKeyOf,
  formatDuration,
  localTzOffsetMinutes,
} from "@/cadence/shared/db/time";
import { PageHeader } from "@/cadence/shared/ui/PageHeader";
import { Card, CardHeader } from "@/cadence/shared/ui/Card";
import {
  dailyFocusMinutes,
  focusStreak,
  hourHistogram,
  planProgress,
  shareByPlan,
  timeByFocusLabel,
  topTasks,
} from "@/cadence/features/stats";

import { DonutChart, FocusTrendChart, HBarList, HourBars } from "./ui/charts";

const TREND_DAYS = 14;

export function StatsPage() {
  const tz = useMemo(() => localTzOffsetMinutes(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) as
    Session[] | undefined;
  const plans = useLiveQuery(
    () => db.plans.where("deletedAt").equals(0).toArray(),
    [],
  );
  const tasks = useLiveQuery(
    () => db.tasks.where("deletedAt").equals(0).toArray(),
    [],
  );

  const now = Date.now();
  const todayKey = dateKeyOf(now, tz);
  const hasData =
    sessions !== undefined && plans !== undefined && tasks !== undefined;

  const days = useMemo(
    () =>
      sessions === undefined
        ? []
        : dailyFocusMinutes(sessions, tz, TREND_DAYS, todayKey),
    [sessions, tz, todayKey],
  );
  const bins = useMemo(
    () => (sessions === undefined ? [] : hourHistogram(sessions, tz, now)),
    [sessions, tz, now],
  );
  const planShares = useMemo(
    () =>
      sessions === undefined || plans === undefined
        ? []
        : shareByPlan(sessions, plans, now),
    [sessions, plans, now],
  );
  const taskTop = useMemo(
    () =>
      sessions === undefined || tasks === undefined
        ? []
        : topTasks(sessions, tasks, now),
    [sessions, tasks, now],
  );
  const labelStats = useMemo(
    () =>
      sessions === undefined || tasks === undefined || plans === undefined
        ? []
        : timeByFocusLabel(sessions, tasks, plans, now),
    [sessions, tasks, plans, now],
  );

  const todayMinutes = days[days.length - 1]?.minutes ?? 0;
  const weekMinutes = days.slice(-7).reduce((sum, day) => sum + day.minutes, 0);
  const meanMinutes =
    days.length > 0
      ? days.reduce((sum, day) => sum + day.minutes, 0) / days.length
      : 0;
  const streak = focusStreak(days);

  const activePlans = (plans ?? []).filter((plan) => plan.status === "active");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insight"
        title="专注统计"
        rule="ripple"
        description="投入、趋势、分配与节律。数据全部来自本地执行记录，进行中的专注按实时时长计入。"
      />

      {!hasData ? (
        <Card>
          <p className="text-ink-3 text-[13px]">统计加载中…</p>
        </Card>
      ) : (
        <>
          {/* KPI 行 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="今日投入"
              value={hoursLabelOf(todayMinutes)}
              hint={`目标之外的一天，从现在开始也来得及`}
              tone="amber"
            />
            <KpiCard
              label="近 7 天合计"
              value={hoursLabelOf(weekMinutes)}
              hint={`日均 ${hoursLabelOf(weekMinutes / 7)}`}
              tone="forest"
            />
            <KpiCard
              label={`近 ${TREND_DAYS} 天日均`}
              value={hoursLabelOf(meanMinutes)}
              hint="虚线参考值即此数"
              tone="craft"
            />
            <KpiCard
              label="连续专注天数"
              value={`${streak} 天`}
              hint={streak > 0 ? "别断了，今天就差这一下" : "从今天开始计"}
              tone="clay"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            {/* 趋势 */}
            <Card className="lg:col-span-3">
              <CardHeader
                title="专注趋势"
                hint={`近 ${TREND_DAYS} 天 · 分钟`}
              />
              <div className="mt-3">
                <FocusTrendChart days={days} />
              </div>
            </Card>

            {/* 占比 */}
            <Card className="lg:col-span-2">
              <CardHeader title="时间去哪了" hint="按计划占比" />
              <div className="mt-3">
                <DonutChart slices={planShares} />
              </div>
            </Card>

            {/* 高效时段 */}
            <Card className="lg:col-span-3">
              <CardHeader title="高效时段" hint="24 小时分布 · 按开始时刻" />
              <div className="mt-3">
                <HourBars bins={bins} />
              </div>
              <p className="text-ink-4 mt-2 text-[11px]">
                把最重要的事排进你的峰值时段 —— 日程面板双击即可预占。
              </p>
            </Card>

            {/* 任务 Top5 */}
            <Card className="lg:col-span-2">
              <CardHeader title="任务投入 Top 5" hint="挂账到任务的专注" />
              <div className="mt-3">
                <HBarList items={taskTop} />
              </div>
            </Card>

            {/* 按名称聚合：同名专注合并总时长 */}
            <Card className="lg:col-span-5">
              <CardHeader
                title="时间花在哪 · 按名称"
                hint="任务/计划/专注名称优先有序 · 同名合并 · 全部时间"
              />
              <div className="mt-3">
                <HBarList
                  items={labelStats}
                  showCount
                  emptyText="还没有可统计的专注。去执行页开始一段，或在日程里围绕事件开始专注。"
                />
              </div>
            </Card>
          </div>

          {/* 计划完成率 */}
          <Card>
            <CardHeader
              title="计划完成率"
              hint="活跃计划 · 直接任务完成占比"
              action={
                <span className="text-ink-4 text-[11px]">
                  {activePlans.length > 0 ? undefined : "还没有活跃计划"}
                </span>
              }
            />
            {activePlans.length > 0 ? (
              <ul className="mt-4 space-y-4">
                {activePlans.map((plan) => {
                  const progress = planProgress(plan.id, tasks ?? []);
                  const ratio = progress?.ratio ?? 0;
                  return (
                    <li key={plan.id}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="text-ink-1 text-[13px]">
                          {plan.title}
                        </span>
                        <span className="text-ink-3 numeric text-[11.5px]">
                          {progress === null
                            ? "暂无任务"
                            : `${progress.done} / ${progress.total} · ${ratio}%`}
                        </span>
                      </div>
                      <div className="surface-inset h-3 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(ratio, progress !== null && progress.total > 0 ? 3 : 0)}%`,
                            background: "var(--color-ochre-base)",
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-ink-3 mt-3 text-[12.5px]">
                去计划页新建一个目标，完成率会按「直接任务完成占比」在这里追踪。
              </p>
            )}
          </Card>

          <p className="text-ink-4 pb-2 text-center text-[11px]">
            统计口径：专注时长按执行记录（Session）起点归属；进行中的专注按实时时长计入。
          </p>
        </>
      )}
    </div>
  );
}

/** 时长（分钟）→ "1 小时 30 分" 形态 */
function hoursLabelOf(minutes: number): string {
  if (minutes < 1) return "0 分";
  return formatDuration(Math.round(minutes * 60_000));
}

/** KPI 卡：数字用衬线大字，色点标维度 */
function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "amber" | "forest" | "craft" | "clay";
}) {
  const dot: Record<string, string> = {
    amber: "var(--color-amber-base)",
    forest: "var(--color-forest-base)",
    craft: "var(--color-craft-base)",
    clay: "var(--color-clay-base)",
  };
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot[tone] }}
        />
        <span className="text-ink-3 truncate text-[11.5px]">{label}</span>
      </div>
      <p className="text-ink-1 font-serif mt-2 text-[26px] leading-none">
        {value}
      </p>
      <p className="text-ink-4 mt-1.5 truncate text-[10.5px]">{hint}</p>
    </Card>
  );
}
