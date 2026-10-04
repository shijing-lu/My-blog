/**
 * 计划详情抽屉 · 任务树
 *
 * 用 PresenceSheet：宽屏右侧抽屉、窄屏底部面板，组件内部自动切换。
 *
 * 关键交互（M3 简化版）：
 *   勾选父任务不联动子任务 —— "父任务完成的语义"是产品决策，
 *   现在先把无歧义的部分做对，联动规则留到真实使用后再定（已写在 usecases 注释里）。
 *   层级上限 3 层，越界时按钮禁用并给出说明，而不是点了没反应。
 */

import { useMemo, useState } from "react";

import type { Plan } from "@/cadence/entities/plan";
import type { Task } from "@/cadence/entities/task";
import { Collapsible, HandRule } from "@/cadence/shared/motion";
import { Button } from "@/cadence/shared/ui/Button";
import { Checkbox } from "@/cadence/shared/ui/Checkbox";
import { ProgressRing } from "@/cadence/shared/ui/ProgressRing";
import { TextField } from "@/cadence/shared/ui/TextField";
import { planProgress } from "@/cadence/features/stats";
import {
  buildTree,
  canHaveChildren,
  type TaskNode,
} from "@/cadence/features/tasks";

interface PlanDetailSheetProps {
  plan: Plan | undefined;
  tasks: readonly Task[];
  onAddTask: (title: string) => void;
  onAddSubtask: (
    parent: TaskNode,
    ancestors: readonly TaskNode[],
    title: string,
  ) => void;
  onToggleTask: (task: Task, done: boolean) => void;
  onDeleteTask: (task: Task) => void;
  /** 更新计划说明（备注）。传入 undefined 表示清空 */
  onUpdatePlanNote: (plan: Plan, note: string | undefined) => void;
  /** 更新任务的标题 / 备注。note 传 undefined 表示清空 */
  onUpdateTask: (
    task: Task,
    draft: { title?: string | undefined; note?: string | undefined },
  ) => void;
  onClose: () => void;
}

export function PlanDetailSheet({
  plan,
  tasks,
  onAddTask,
  onAddSubtask,
  onToggleTask,
  onDeleteTask,
  onUpdatePlanNote,
  onUpdateTask,
  onClose,
}: PlanDetailSheetProps) {
  const [draft, setDraft] = useState("");

  const tree = useMemo(
    () =>
      plan === undefined
        ? []
        : buildTree(tasks.filter((task) => task.planId === plan.id)),
    [plan, tasks],
  );
  const progress = useMemo(
    () => (plan === undefined ? null : planProgress(plan.id, tasks)),
    [plan, tasks],
  );

  const add = () => {
    const title = draft.trim();
    if (title.length === 0) return;
    onAddTask(title);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col">
      {plan === undefined ? null : (
        <>
          <div className="flex items-start gap-4">
            <ProgressRing
              value={progress?.ratio ?? 0}
              size={72}
              thickness={7}
              semantic={plan.color}
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-ink-1 text-lg">{plan.title}</h3>
              <PlanNote
                plan={plan}
                onSave={(note) => onUpdatePlanNote(plan, note)}
              />
              <p className="text-ink-4 numeric mt-2 text-[11.5px]">
                {progress === null
                  ? "暂无任务"
                  : `${progress.done} / ${progress.total} 项完成 · ${progress.ratio}%`}
              </p>
            </div>
          </div>

          <HandRule shape="ripple" className="my-5" />

          <div className="flex items-end gap-3">
            <TextField
              label="添加任务"
              value={draft}
              placeholder="输入后按回车添加"
              className="flex-1"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button size="sm" onClick={add}>
              添加
            </Button>
          </div>

          <div className="mt-5 flex-1 overflow-y-auto">
            {tree.length === 0 ? (
              <p className="text-ink-4 py-8 text-center text-[12.5px]">
                还没有任务。把目标拆成几步，进度才有意义。
              </p>
            ) : (
              <ul className="space-y-1">
                {tree.map((node) => (
                  <TaskBranch
                    key={node.task.id}
                    node={node}
                    ancestors={[]}
                    onAddSubtask={onAddSubtask}
                    onToggleTask={onToggleTask}
                    onDeleteTask={onDeleteTask}
                    onUpdateTask={onUpdateTask}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface TaskBranchProps {
  node: TaskNode;
  ancestors: readonly TaskNode[];
  onAddSubtask: (
    parent: TaskNode,
    ancestors: readonly TaskNode[],
    title: string,
  ) => void;
  onToggleTask: (task: Task, done: boolean) => void;
  onDeleteTask: (task: Task) => void;
  onUpdateTask: (
    task: Task,
    draft: { title?: string | undefined; note?: string | undefined },
  ) => void;
}

function TaskBranch({
  node,
  ancestors,
  onAddSubtask,
  onToggleTask,
  onDeleteTask,
  onUpdateTask,
}: TaskBranchProps) {
  const [subDraft, setSubDraft] = useState("");
  const [open, setOpen] = useState(true);
  const [noteEditing, setNoteEditing] = useState(false);
  const hasChildren = node.children.length > 0;
  const canNest = canHaveChildren(ancestors);
  /** 无子任务时，"拆子任务"按钮只负责**展开**输入框，不负责收起 —— 否则点了它输入框就消失 */
  const toggleOrReveal = () => setOpen(hasChildren ? (value) => !value : true);

  const addSub = () => {
    const title = subDraft.trim();
    if (title.length === 0) return;
    onAddSubtask(node, ancestors, title);
    setSubDraft("");
  };

  const row = (
    <div className="flex items-center gap-2 py-1">
      <Checkbox
        checked={node.task.status === "done"}
        onChange={(checked) => onToggleTask(node.task, checked)}
        label={node.task.title}
      >
        <span className="text-[13.5px]">{node.task.title}</span>
      </Checkbox>

      {/* 备注指示与入口：有备注显示墨点，无备注显示"+"，点击都在下方展开编辑器 */}
      <button
        type="button"
        onClick={() => setNoteEditing(true)}
        aria-label={
          node.task.note !== undefined
            ? `查看备注 ${node.task.title}`
            : `添加备注 ${node.task.title}`
        }
        className={[
          "craft-transition-fast rounded-full px-2 py-1 text-[11px]",
          node.task.note !== undefined
            ? "text-amber-deep"
            : "text-ink-4 hover:text-ink-2",
        ].join(" ")}
      >
        {node.task.note !== undefined ? "● 备注" : "+ 备注"}
      </button>

      <span className="flex-1" />

      {canNest ? (
        <button
          type="button"
          onClick={toggleOrReveal}
          aria-expanded={open}
          className="text-ink-4 hover:text-ink-2 craft-transition-fast rounded-full px-2 py-1 text-[11.5px]"
        >
          {hasChildren ? `${node.doneCount}/${node.totalCount}` : "拆子任务"}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onDeleteTask(node.task)}
        aria-label={`删除任务 ${node.task.title}`}
        className="text-ink-4 hover:text-clay-deep craft-transition-fast rounded-full px-2 py-1 text-[11.5px]"
      >
        删除
      </button>
    </div>
  );

  return (
    <li>
      {row}

      {/* 备注：查看 + 就地编辑（任务与子任务同一套交互） */}
      {noteEditing ? (
        <NoteEditor
          initial={node.task.note}
          title={node.task.title}
          onSave={(note) => {
            onUpdateTask(node.task, { note });
            setNoteEditing(false);
          }}
          onCancel={() => setNoteEditing(false)}
        />
      ) : node.task.note !== undefined ? (
        <p className="text-ink-3 pl-6 text-[12px] leading-relaxed">
          {node.task.note}
        </p>
      ) : null}

      {hasChildren ? (
        <Collapsible
          open={open}
          onOpenChange={setOpen}
          trigger={
            <span className="text-ink-4 cursor-pointer pl-6 text-[11px]">
              {open ? "收起子任务" : `展开 ${node.children.length} 项子任务`}
            </span>
          }
        >
          <ul
            className="mt-1 space-y-1 pl-6"
            style={{ boxShadow: "inset 1px 0 0 0 var(--color-paper-line)" }}
          >
            {node.children.map((child) => (
              <TaskBranch
                key={child.task.id}
                node={child}
                ancestors={[...ancestors, node]}
                onAddSubtask={onAddSubtask}
                onToggleTask={onToggleTask}
                onDeleteTask={onDeleteTask}
                onUpdateTask={onUpdateTask}
              />
            ))}
          </ul>
        </Collapsible>
      ) : null}

      {/* 无子任务时输入框常显（不受 open 影响）：open 只用于控制"已有子任务的折叠" */}
      {!hasChildren ? (
        <div className="mt-1 flex items-center gap-2 pl-6">
          <input
            value={subDraft}
            placeholder="子任务…"
            aria-label={`为「${node.task.title}」添加子任务`}
            onChange={(event) => setSubDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSub();
              }
            }}
            className="text-ink-1 placeholder:text-ink-4 flex-1 bg-transparent py-1 text-[12.5px] outline-none"
          />
          <button
            type="button"
            onClick={addSub}
            className="text-ink-4 hover:text-ink-2 craft-transition-fast rounded-full px-2 py-1 text-[11.5px]"
          >
            添加
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** 计划说明：查看 + 点击就地编辑（承载标题装不下的背景与验收标准） */
function PlanNote({
  plan,
  onSave,
}: {
  plan: Plan;
  onSave: (note: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <NoteEditor
        initial={plan.description}
        title={plan.title}
        onSave={(note) => {
          onSave(note);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="mt-1">
      {plan.description !== undefined ? (
        <p className="text-ink-3 text-[12.5px] leading-relaxed">
          {plan.description}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-ink-4 hover:text-ink-2 craft-transition-fast mt-0.5 text-[11px]"
      >
        {plan.description !== undefined ? "编辑说明" : "+ 说明"}
      </button>
    </div>
  );
}

/** 备注编辑器（计划说明与任务备注共用）：多行输入，空串 = 清空备注 */
function NoteEditor({
  initial,
  title,
  onSave,
  onCancel,
}: {
  initial: string | undefined;
  title: string;
  onSave: (note: string | undefined) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial ?? "");

  const save = () => {
    const trimmed = draft.trim();
    onSave(trimmed.length > 0 ? trimmed : undefined);
  };

  return (
    <div className="bg-amber-soft/60 mt-1 rounded-[var(--radius-hand-sm)] p-3">
      <TextField
        label={
          initial !== undefined ? `编辑备注 · ${title}` : `添加备注 · ${title}`
        }
        hideLabel
        value={draft}
        multiline
        rows={3}
        placeholder="补充说明：验收标准、卡点、参考链接…（留空保存即删除备注）"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") onCancel();
        }}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-ink-4 hover:text-ink-2 craft-transition-fast rounded-full px-2 py-1 text-[11.5px]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={save}
          className="craft-transition-fast rounded-full bg-amber-deep px-3 py-1 text-[11.5px] text-paper-base hover:bg-amber-base"
        >
          保存
        </button>
      </div>
    </div>
  );
}
