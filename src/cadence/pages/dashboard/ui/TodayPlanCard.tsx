/**
 * 今日计划卡（docs/07-每日计划模块.md）
 *
 * 总览页的执行清单。跨模块联动（勾选→完成任务、开始专注→挂账计划）在
 * 这里组合 —— pages 层允许自由组合各 features，规则见 docs/07 §3。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";

import { dailyPlanIdOf, dailyProgress } from "@/cadence/entities/daily-plan";
import { db } from "@/cadence/data/db/database";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { TextField } from "@/cadence/shared/ui/TextField";
import {
  addItem,
  createDailyPlanDeps,
  removeItem,
  setItemDone,
} from "@/cadence/features/daily-plan";
import { createTaskDeps, setTaskStatus } from "@/cadence/features/tasks";
import { createSessionDeps, startSession } from "@/cadence/features/execute";
import { NOT_DELETED } from "@/cadence/shared/model/entity";

const KIND_LABEL: Record<string, string> = {
  task: "任务",
  todo: "待办",
  free: "今日",
};

export function TodayPlanCard({ dateKey }: { dateKey: string }) {
  const deps = useMemo(() => createDailyPlanDeps(db), []);
  const [draft, setDraft] = useState("");

  const plan = useLiveQuery(
    () => db.dailyPlans.get(dailyPlanIdOf(dateKey)),
    [dateKey],
  );
  const items = plan?.items ?? [];
  const progress = dailyProgress(items);

  const add = () => {
    const title = draft.trim();
    if (title.length === 0) return;
    void addItem(deps, dateKey, { kind: "free", title }, Date.now())
      .then(() => setDraft(""))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "添加失败"),
      );
  };

  /** 勾选联动（docs/07 §3.2）：勾选完成 → 引用任务一并完成（正向单向，取消不回退） */
  const toggleItem = (
    itemId: string,
    done: boolean,
    kind: string,
    refId: string | undefined,
  ) => {
    void setItemDone(deps, dateKey, itemId, done, Date.now())
      .then(async () => {
        if (!done || kind !== "task" || refId === undefined) return;
        const task = await db.tasks.get(refId);
        if (
          task !== undefined &&
          task.deletedAt === NOT_DELETED &&
          task.status !== "done"
        ) {
          await setTaskStatus(createTaskDeps(db), task, "done", Date.now());
          toast.success("关联任务已同步完成");
        }
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "操作失败"),
      );
  };

  /** 开始专注联动（docs/07 §3.4）：执行记录挂 planId/taskId，统计归对账本 */
  const focusItem = (
    title: string,
    kind: string,
    refId: string | undefined,
  ) => {
    void (async () => {
      let planId: string | undefined;
      let taskId: string | undefined;
      if (kind === "task" && refId !== undefined) {
        const task = await db.tasks.get(refId);
        if (task !== undefined && task.deletedAt === NOT_DELETED) {
          taskId = task.id;
          planId = task.planId;
        }
      }
      await startSession(
        createSessionDeps(db),
        { note: title, planId, taskId },
        Date.now(),
      );
      toast.success(`已围绕「${title}」开始专注`);
    })().catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "无法开始专注"),
    );
  };

  return (
    <section className="surface-card cadence-overview-card" aria-label="今日计划">
      <div className="cadence-card-heading flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px]">今日计划</h3>
        <span className="text-ink-3 numeric text-[11px]">
          {progress.total === 0
            ? "还没有安排"
            : `${progress.done} / ${progress.total} 项完成`}
        </span>
      </div>

      <div className="cadence-card-scroll" tabIndex={0} role="region" aria-label="今日计划事项">
      {items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="surface-inset flex flex-wrap items-center gap-2 rounded-[var(--radius-hand-sm)] px-2 py-2"
            >
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) =>
                  toggleItem(
                    item.id,
                    event.target.checked,
                    item.kind,
                    item.refId,
                  )
                }
                aria-label={`完成 ${item.title}`}
                className="h-4 w-4"
                style={{ accentColor: "var(--color-amber-base)" }}
              />
              <span
                className={[
                  "min-w-0 flex-1 basis-[calc(100%-2rem)] break-words text-[13px]",
                  item.done ? "text-ink-4 line-through" : "text-ink-1",
                ].join(" ")}
              >
                {item.title}
              </span>
              {item.estimateMinutes !== undefined ? (
                <span
                  className="text-ink-4 numeric text-[10.5px]"
                  title="预估专注时长"
                >
                  ≈{item.estimateMinutes}min
                </span>
              ) : null}
              <span className="text-ink-4 rounded-[var(--radius-hand-sm)] px-1.5 py-0.5 text-[10.5px]">
                {KIND_LABEL[item.kind]}
              </span>
              {!item.done ? (
                <button
                  type="button"
                  onClick={() => focusItem(item.title, item.kind, item.refId)}
                  className="text-amber-deep craft-transition-fast rounded-full px-2 py-1 text-[11px] hover:underline"
                >
                  开始专注
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  void removeItem(deps, dateKey, item.id, Date.now())
                }
                aria-label={`移除 ${item.title}`}
                className="text-ink-4 hover:text-clay-deep craft-transition-fast rounded-full px-2 py-1 text-[11px]"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-4 py-4 text-center text-[12.5px]">
          把今天要做的 3–5
          件事排进来。也可以直接对右下角的助手说「制定今天的计划：…」
        </p>
      )}
      </div>

      <div className="cadence-card-footer flex items-center gap-2">
        <TextField
          label="添加今日事项"
          hideLabel
          value={draft}
          placeholder="加一件事"
          className="min-w-0 flex-1 !pb-0"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" variant="ghost" onClick={add}>
          添加
        </Button>
      </div>
    </section>
  );
}
