/**
 * 计划页（M3 真实实现）
 * ---------------------------------------------------------------------------
 * 响应式数据来源：`useLiveQuery` —— Dexie 的变更会自动推送，
 * 无需在每次写操作后手动 setState。这是选 Dexie 而非裸 IndexedDB 的主要理由之一。
 *
 * 页面只做三件事：读数据、调用用例、渲染。
 * 业务规则（级联删除、排序取中点、进度口径）全在 features 层，页面里没有一处。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";

import type { Plan } from "@/cadence/entities/plan";
import type { Task } from "@/cadence/entities/task";
import { db } from "@/cadence/data/db/database";
import { AnimatedList, HandRule, PresenceSheet } from "@/cadence/shared/motion";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { Card } from "@/cadence/shared/ui/Card";
import { ConfirmDialog } from "@/cadence/shared/ui/ConfirmDialog";
import { PageHeader } from "@/cadence/shared/ui/PageHeader";
import { ProgressRing } from "@/cadence/shared/ui/ProgressRing";
import { Tag } from "@/cadence/shared/ui/Tag";
import { planProgress } from "@/cadence/features/stats";
import {
  changePlanStatus,
  createPlan,
  createPlanDeps,
  deletePlan,
  restorePlan,
  updatePlanDetails,
  type PlanDraft,
} from "@/cadence/features/plans";
import {
  createSubtask,
  createTask,
  deleteTask,
  setTaskStatus,
  updateTaskDetails,
  type TaskDeps,
} from "@/cadence/features/tasks";
import { PlanDetailSheet } from "./ui/PlanDetailSheet";
import { PlanFormDialog } from "./ui/PlanFormDialog";

const STATUS_LABEL: Record<Plan["status"], string> = {
  active: "进行中",
  paused: "暂停",
  completed: "完成",
  archived: "归档",
};

const STATUS_TONE: Record<
  Plan["status"],
  "plan" | "session" | "done" | "review" | "archive"
> = {
  active: "plan",
  paused: "session",
  completed: "done",
  archived: "archive",
};

export function PlansPage() {
  const deps = useMemo(() => createPlanDeps(db), []);
  const taskDeps: TaskDeps = useMemo(() => ({ tasks: deps.tasks }), [deps]);

  const plans = useLiveQuery(() => deps.plans.list(), [deps]) ?? [];
  const allTasks = useLiveQuery(() => deps.tasks.list(), [deps]) ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<Plan | undefined>(
    undefined,
  );

  const detailPlan = plans.find((plan) => plan.id === detailId);

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setFormOpen(true);
  };

  const submitForm = (draft: PlanDraft) => {
    const now = Date.now();
    if (editing === undefined) {
      createPlan(deps, draft, now).then(() => toast.success("计划已创建"));
    } else {
      updatePlanDetails(deps, editing.id, draft, now).then(() =>
        toast.success("计划已更新"),
      );
    }
  };

  const confirmDelete = (plan: Plan) => {
    const now = Date.now();
    void deletePlan(deps, plan.id, now).then((count) => {
      setPendingDelete(undefined);
      if (detailId === plan.id) setDetailId(undefined);
      toast.undoable(
        count > 0
          ? `已删除「${plan.title}」，连带 ${count} 个任务`
          : `已删除「${plan.title}」`,
        () => {
          void restorePlan(deps, plan.id, Date.now()).then(() =>
            toast.success("已恢复"),
          );
        },
      );
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Plans"
        title="计划"
        rule="wave"
        description="一个有始有终的目标容器。进度按「直接任务完成率」统计，归档后执行记录与复盘数据仍然保留。"
        action={<Button onClick={openCreate}>新建计划</Button>}
      />

      <HandRule shape="gentle" />

      {plans.length === 0 ? (
        <Card>
          <p className="text-ink-3 text-[13px]">
            还没有计划。先建立一个「有始有终」的目标，再把它拆成任务 ——
            进度是拆完之后才有意义的东西。
          </p>
        </Card>
      ) : (
        <AnimatedList
          items={plans}
          getKey={(plan) => plan.id}
          className="grid gap-4 sm:grid-cols-2"
          renderItem={(plan) => (
            <PlanCard
              plan={plan}
              tasks={allTasks}
              onOpen={() => setDetailId(plan.id)}
              onEdit={() => openEdit(plan)}
              onTogglePause={() =>
                void changePlanStatus(
                  deps,
                  plan.id,
                  plan.status === "paused" ? "active" : "paused",
                  Date.now(),
                )
              }
              onDelete={() => setPendingDelete(plan)}
            />
          )}
        />
      )}

      <PlanFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        plan={editing}
        onSubmit={submitForm}
      />

      <PresenceSheet
        open={detailPlan !== undefined}
        onOpenChange={(open) => {
          if (!open) setDetailId(undefined);
        }}
        title={detailPlan?.title ?? ""}
        description="任务最多 3 层：计划 → 任务 → 子任务"
      >
        <PlanDetailSheet
          plan={detailPlan}
          tasks={allTasks}
          onAddTask={(title) => {
            if (detailPlan === undefined) return;
            void createTask(taskDeps, detailPlan.id, { title }, Date.now());
          }}
          onAddSubtask={(parent, ancestors, title) => {
            void createSubtask(
              taskDeps,
              parent,
              ancestors,
              { title },
              Date.now(),
            ).catch((error: unknown) => {
              toast.error(
                error instanceof Error ? error.message : "子任务创建失败",
              );
            });
          }}
          onToggleTask={(task, done) => {
            void setTaskStatus(
              taskDeps,
              task,
              done ? "done" : "todo",
              Date.now(),
            );
          }}
          onDeleteTask={(task) => {
            void deleteTask(taskDeps, task.planId, task.id, Date.now());
          }}
          onUpdatePlanNote={(plan, note) => {
            void updatePlanDetails(
              deps,
              plan.id,
              { title: plan.title, description: note },
              Date.now(),
            );
          }}
          onUpdateTask={(task, draft) => {
            void updateTaskDetails(taskDeps, task, draft, Date.now()).catch(
              (error: unknown) => {
                toast.error(
                  error instanceof Error ? error.message : "任务更新失败",
                );
              },
            );
          }}
          onClose={() => setDetailId(undefined)}
        />
      </PresenceSheet>

      <ConfirmDialog
        open={pendingDelete !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
        title="删除这个计划？"
        description="计划与其下全部任务会进入回收站，30 天内可恢复。"
        danger
        confirmLabel="删除"
        onConfirm={() => {
          if (pendingDelete !== undefined) confirmDelete(pendingDelete);
        }}
      />
    </div>
  );
}

function PlanCard({
  plan,
  tasks,
  onOpen,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  plan: Plan;
  tasks: readonly Task[];
  onOpen: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const progress = planProgress(plan.id, tasks);

  return (
    <Card interactive>
      <div className="flex items-start gap-4">
        <ProgressRing
          value={progress.ratio ?? 0}
          size={68}
          thickness={7}
          semantic={plan.color}
        />

        <button
          type="button"
          onClick={onOpen}
          title={plan.title}
          className="min-w-0 flex-1 text-left"
        >
          <h3 className="text-ink-1 line-clamp-2 break-words text-[15px]">{plan.title}</h3>
          {plan.description ? (
            <p className="text-ink-3 mt-1 line-clamp-2 text-[12px] leading-relaxed">
              {plan.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag tone={STATUS_TONE[plan.status]} dot>
              {STATUS_LABEL[plan.status]}
            </Tag>
            <span className="text-ink-4 numeric text-[11px]">
              {progress.total === 0
                ? "暂无任务"
                : `${progress.done} / ${progress.total} 项`}
            </span>
          </div>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onTogglePause}>
          {plan.status === "paused" ? "继续" : "暂停"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          编辑
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          删除
        </Button>
      </div>
    </Card>
  );
}
