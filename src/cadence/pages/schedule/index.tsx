/**
 * 日程页（24 小时面板）
 * 依据：docs/08-日程面板.md
 * ---------------------------------------------------------------------------
 * 页面只做组合：读数据、调用例、渲染网格；拖拽细节在 TimeGrid。
 * 跨模块联动（完成→任务、专注→Session）在页面层组合 —— 分层规则见 docs/08 §3。
 *
 * 初始滚动（用户验收点）：面板高 1584px（24h × 1.1px/min）远超视口，
 * 默认停在 00:00 意味着用户每次进来都要手动拖到"现在"。
 * 所以挂载时（以及切回今天时）把当前时刻滚到视口上部 —— 见 TIME_GRID_PX_PER_MIN。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ScheduleEvent } from "@/cadence/entities/schedule";
import { DAY_TOTAL_MIN, snapDown } from "@/cadence/entities/schedule";
import { db } from "@/cadence/data/db/database";
import {
  addDays,
  dateKeyOf,
  localTzOffsetMinutes,
  formatDuration,
  startOfDayMs,
} from "@/cadence/shared/db/time";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { PageHeader } from "@/cadence/shared/ui/PageHeader";
import {
  createScheduleDeps,
  createEvent,
  moveEvent,
  removeEvent,
  resizeEvent,
  setEventDone,
  updateEventDetails,
  type ScheduleDeps,
} from "@/cadence/features/schedule";
import {
  createDailyPlanDeps,
  setItemDone,
} from "@/cadence/features/daily-plan";
import { createTaskDeps, setTaskStatus } from "@/cadence/features/tasks";
import { createSessionDeps, startSession } from "@/cadence/features/execute";
import { NOT_DELETED } from "@/cadence/shared/model/entity";

import { TimeGrid, TIME_GRID_PX_PER_MIN } from "./ui/TimeGrid";
import {
  CreateEventDialog,
  EditEventDialog,
  type CreateDialogState,
} from "./ui/EventDialogs";

/** 当前时刻滚到视口上方留出的余量（像素）：上面留一点已过去的时段，便于回看 */
const SCROLL_HEADROOM_PX = 60;

export function SchedulePage() {
  const deps: ScheduleDeps = useMemo(() => createScheduleDeps(db), []);
  const [tz] = useState(() => localTzOffsetMinutes());
  const [selectedKey, setSelectedKey] = useState(() =>
    dateKeyOf(Date.now(), localTzOffsetMinutes()),
  );

  const [createState, setCreateState] = useState<CreateDialogState | undefined>(
    undefined,
  );
  const [editing, setEditing] = useState<ScheduleEvent | undefined>(undefined);

  const events =
    useLiveQuery(
      () =>
        deps.database.scheduleEvents
          .where("dateKey")
          .equals(selectedKey)
          .toArray(),
      [deps, selectedKey],
    ) ?? [];
  const dailyPlan = useLiveQuery(
    () => db.dailyPlans.get(`daily-${selectedKey}`),
    [selectedKey],
  );

  const todayKey = dateKeyOf(Date.now(), tz);
  const nowMin =
    selectedKey === todayKey
      ? Math.floor((Date.now() - startOfDayMs(todayKey, tz)) / 60_000)
      : undefined;

  /**
   * 初始滚动到"现在"。
   * 依赖 selectedKey：挂载时滚一次；用户点"回到今天"时再滚一次。
   * ---------------------------------------------------------------------------
   * 两个分支都要处理，否则会留下"翻到昨天却停在上次滚动位置"的怪状态：
   *   - 今天（nowMin 有值）→ 滚到当前时刻，上方留一点已过去的时段
   *   - 非今天（nowMin 为 undefined）→ 回到顶部（00:00），那天的"现在"没有意义
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scrollRef.current;
    if (box === null) return;
    const target =
      nowMin === undefined
        ? 0
        : Math.max(0, nowMin * TIME_GRID_PX_PER_MIN - SCROLL_HEADROOM_PX);
    box.scrollTop = target;
    // 首次渲染时子元素（事件块等）可能还没量出高度，scrollTop 会被夹到 0。
    // 用 rAF 在布局稳定后补一次，确保真滚到目标位置。
    const raf = window.requestAnimationFrame(() => {
      if (scrollRef.current !== null) scrollRef.current.scrollTop = target;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [selectedKey, nowMin, todayKey]);

  const totalMin = events
    .filter((event) => !event.done)
    .reduce((sum, event) => sum + (event.endMin - event.startMin), 0);

  /* ── 联动组合（docs/08 §3） ── */

  const handleError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : "操作失败");

  const handleMove = (id: string, newStartMin: number) => {
    void moveEvent(deps, selectedKey, id, newStartMin, Date.now()).catch(
      handleError,
    );
  };
  const handleResize = (id: string, newEndMin: number) => {
    void resizeEvent(deps, selectedKey, id, newEndMin, Date.now()).catch(
      handleError,
    );
  };

  const handleCreate = (input: {
    title: string;
    startMin: number;
    endMin: number;
    planItemId?: string | undefined;
  }) => {
    void createEvent(
      deps,
      selectedKey,
      {
        title: input.title,
        startMin: input.startMin,
        endMin: input.endMin,
        refKind: input.planItemId !== undefined ? "plan-item" : "free",
        refId: input.planItemId,
      },
      Date.now(),
    )
      .then((event) => {
        setCreateState(undefined);
        toast.success(`日程「${event.title}」已创建`);
      })
      .catch(handleError);
  };

  /** 完成联动（docs/08 §3.3）：引用任务 → 任务完成；引用今日计划项 → 日项勾选 */
  const handleToggleDone = (id: string, done: boolean) => {
    void setEventDone(deps, selectedKey, id, done, Date.now())
      .then(async (event) => {
        if (!done || event.refId === undefined) return;
        if (event.refKind === "task") {
          const task = await db.tasks.get(event.refId);
          if (
            task !== undefined &&
            task.deletedAt === NOT_DELETED &&
            task.status !== "done"
          ) {
            await setTaskStatus(createTaskDeps(db), task, "done", Date.now());
            toast.success("关联任务已同步完成");
          }
        } else if (event.refKind === "plan-item") {
          const plan = await db.dailyPlans.get(`daily-${selectedKey}`);
          if (plan?.items.some((item) => item.id === event.refId)) {
            await setItemDone(
              createDailyPlanDeps(db),
              selectedKey,
              event.refId,
              true,
              Date.now(),
            );
          }
        }
      })
      .catch(handleError);
  };

  /** 对事件开始专注：引用任务 → 挂账 planId/taskId（docs/08 §3.4） */
  const handleFocus = (event: ScheduleEvent) => {
    void (async () => {
      let planId: string | undefined;
      let taskId: string | undefined;
      if (event.refKind === "task" && event.refId !== undefined) {
        const task = await db.tasks.get(event.refId);
        if (task !== undefined && task.deletedAt === NOT_DELETED) {
          taskId = task.id;
          planId = task.planId;
        }
      }
      await startSession(
        createSessionDeps(db),
        { note: event.title, planId, taskId },
        Date.now(),
      );
      toast.success(`已围绕「${event.title}」开始专注`);
    })().catch(handleError);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Schedule"
        title="日程"
        rule="ripple"
        description="把一天切成时间块：双击空档新建，拖拽平移，拖底缘调时长。重叠会被拒绝——时间只有一份。"
        action={
          <Button
            onClick={() =>
              setCreateState({
                startMin: Math.min(
                  snapDown(nowMin ?? 9 * 60),
                  DAY_TOTAL_MIN - 60,
                ),
                endMin: Math.min(
                  snapDown(nowMin ?? 9 * 60) + 60,
                  DAY_TOTAL_MIN,
                ),
              })
            }
          >
            新建日程
          </Button>
        }
      />

      {/* 日期切换 + 概要 */}
      <div className="neo-schedule-datebar flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedKey(addDays(selectedKey, -1, tz))}
          >
            ← 前一天
          </Button>
          <div className="text-center">
            <p className="text-ink-1 font-serif text-[17px]">{selectedKey}</p>
            <button
              type="button"
              onClick={() => setSelectedKey(dateKeyOf(Date.now(), tz))}
              className="text-ink-4 hover:text-ink-2 craft-transition-fast text-[11px]"
            >
              回到今天
            </button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedKey(addDays(selectedKey, 1, tz))}
          >
            后一天 →
          </Button>
        </div>
        <p className="text-ink-3 numeric text-[12px]">
          {events.length} 个日程 · 未完成 {formatDuration(totalMin * 60_000)}
        </p>
      </div>

      {/* 24 小时面板：挂载/回到今天时自动滚到当前时刻 */}
      <div
        className="neo-schedule-timeboard max-h-[72vh] overflow-y-auto pr-1"
        data-testid="schedule-scroll"
        ref={scrollRef}
      >
        <TimeGrid
          events={events}
          nowMin={nowMin}
          onMove={handleMove}
          onResize={handleResize}
          onOpen={setEditing}
          onCreateAt={(startMin) =>
            setCreateState({
              startMin,
              endMin: Math.min(startMin + 60, DAY_TOTAL_MIN),
            })
          }
        />
        <p className="text-ink-4 mt-2 text-center text-[11px]">
          双击空白处新建 · 拖动平移 · 拖底缘调时长（1 分钟吸附）·
          时间重叠会被拒绝
        </p>
      </div>

      <CreateEventDialog
        state={createState}
        planItems={dailyPlan?.items ?? []}
        onCreate={handleCreate}
        onCancel={() => setCreateState(undefined)}
      />

      <EditEventDialog
        event={editing}
        onSave={(id, draft) => {
          void updateEventDetails(deps, selectedKey, id, draft, Date.now())
            .then(() => {
              setEditing(undefined);
              toast.success("已保存");
            })
            .catch(handleError);
        }}
        onDelete={(id) => {
          void removeEvent(deps, id).then(() => {
            setEditing(undefined);
            toast.success("日程已删除");
          });
        }}
        onToggleDone={handleToggleDone}
        onFocus={handleFocus}
        onClose={() => setEditing(undefined)}
      />
    </div>
  );
}
