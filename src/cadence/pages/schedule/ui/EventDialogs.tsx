/**
 * 日程对话框：新建（双击空档触发）与编辑（点击事件块触发）
 * 联动组合在页面层完成（docs/08 §3）—— 这里只收集输入。
 */

import { useMemo, useState } from "react";

import type { ScheduleEvent } from "@/cadence/entities/schedule";
import type { DailyPlanItem } from "@/cadence/entities/daily-plan";
import { PresenceDialog } from "@/cadence/shared/motion";
import { Button } from "@/cadence/shared/ui/Button";
import { ConfirmDialog } from "@/cadence/shared/ui/ConfirmDialog";
import { TextField } from "@/cadence/shared/ui/TextField";

import { TimeField } from "./TimeField";
import { validTimeSpan } from "@/cadence/entities/schedule/time-input";
function minuteLabel(min: number): string { return min === 1440 ? "24:00" : String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }

export interface CreateDialogState {
  startMin: number;
  endMin: number;
}

export function CreateEventDialog({
  state,
  planItems,
  onCreate,
  onCancel,
}: {
  state: CreateDialogState | undefined;
  planItems: readonly DailyPlanItem[];
  onCreate: (input: {
    title: string;
    startMin: number;
    endMin: number;
    planItemId?: string | undefined;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(9 * 60);
  const [end, setEnd] = useState(10 * 60);
  const [planItemId, setPlanItemId] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // 每次打开时以双击位置重置
  if (state !== undefined && !hydrated) {
    setStart(state.startMin);
    setEnd(state.endMin);
    setTitle("");
    setPlanItemId("");
    setHydrated(true);
  } else if (state === undefined && hydrated) {
    setHydrated(false);
  }

  const linkedTitle = useMemo(
    () => planItems.find((item) => item.id === planItemId)?.title,
    [planItems, planItemId],
  );

  return (
    <PresenceDialog open={state !== undefined} onOpenChange={(open) => { if (!open) onCancel(); }} title="新建日程">
      {state !== undefined ? (
        <div>
            <div className="mt-4 space-y-4">
              <TextField
                label="标题"
                value={
                  linkedTitle !== undefined && title.length === 0
                    ? linkedTitle
                    : title
                }
                onChange={(event) => setTitle(event.target.value)}
                placeholder="这段时间做什么"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    if (!validTimeSpan(start, end)) return;
                    event.preventDefault();
                    onCreate({
                      title:
                        linkedTitle !== undefined && title.length === 0
                          ? linkedTitle
                          : title,
                      startMin: start,
                      endMin: end,
                      planItemId:
                        planItemId.length > 0 ? planItemId : undefined,
                    });
                  }
                }}
              />
              <div className="neo-schedule-time-fields grid grid-cols-2 gap-3">
                <TimeField
                  label="开始"
                  value={start}
                  onChange={setStart}
                />
                <TimeField
                  label="结束"
                  value={end}
                  allowDayEnd
                  onChange={setEnd}
                />
              </div>
              {!validTimeSpan(start, end) && <p role="alert" className="text-xs text-destructive">请输入有效时间，结束须晚于开始，最短 1 分钟。</p>}
              {planItems.length > 0 ? (
                <label className="text-ink-2 block text-[12.5px]">
                  关联今日计划项（可选）
                  <select
                    value={planItemId}
                    onChange={(event) => setPlanItemId(event.target.value)}
                    className="text-ink-1 surface-inset mt-1 block w-full rounded-[var(--radius-hand-sm)] px-3 py-2 text-[13px]"
                  >
                    <option value="">不关联</option>
                    {planItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={!validTimeSpan(start, end)}
                onClick={() =>
                  onCreate({
                    title:
                      linkedTitle !== undefined && title.length === 0
                        ? linkedTitle
                        : title,
                    startMin: start,
                    endMin: end,
                    planItemId: planItemId.length > 0 ? planItemId : undefined,
                  })
                }
              >
                创建
              </Button>
            </div>
        </div>
      ) : null}
    </PresenceDialog>
  );
}

export function EditEventDialog({
  event,
  onSave,
  onDelete,
  onToggleDone,
  onFocus,
  onClose,
}: {
  event: ScheduleEvent | undefined;
  onSave: (id: string, draft: { title: string; note?: string; startMin: number; endMin: number }) => void;
  onDelete: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onFocus: (event: ScheduleEvent) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(1);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hydratedFor, setHydratedFor] = useState("");

  if (event !== undefined && event.id !== hydratedFor) {
    setStart(event.startMin); setEnd(event.endMin);
    setTitle(event.title);
    setNote(event.note ?? "");
    setHydratedFor(event.id);
    setConfirmingDelete(false);
  } else if (event === undefined && hydratedFor !== "") {
    setHydratedFor("");
  }

  return (
    <>
      <PresenceDialog open={event !== undefined} onOpenChange={(open) => { if (!open) onClose(); }} title="编辑日程">
        {event !== undefined ? (
          <div>
              <p className="text-ink-4 numeric text-[11px]">
                {minuteLabel(event.startMin)} – {minuteLabel(event.endMin)}
              </p>
              <div className="neo-schedule-time-fields mt-3 grid grid-cols-2 gap-3"><TimeField label="开始" value={start} onChange={setStart} /><TimeField label="结束" value={end} onChange={setEnd} allowDayEnd /></div>
              {!validTimeSpan(start, end) && <p role="alert" className="text-xs text-destructive">请输入有效时间，结束须晚于开始。</p>}
              <TextField
                label="标题"
                value={title}
                onChange={(changeEvent) => setTitle(changeEvent.target.value)}
              />
              <div className="mt-3">
                <TextField
                  label="备注"
                  hideLabel
                  value={note}
                  multiline
                  rows={2}
                  placeholder="备注（可选）"
                  onChange={(changeEvent) => setNote(changeEvent.target.value)}
                />
              </div>

              <label className="mt-3 flex items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={event.done}
                  onChange={(changeEvent) =>
                    onToggleDone(event.id, changeEvent.target.checked)
                  }
                  className="h-4 w-4"
                  style={{ accentColor: "var(--color-amber-base)" }}
                />
                <span className={event.done ? "text-ink-4" : "text-ink-2"}>
                  {event.done ? "已完成" : "标记完成"}
                </span>
              </label>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmingDelete(true)}
                >
                  删除
                </Button>
                <div className="flex gap-2">
                  {!event.done ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onFocus(event);
                        onClose();
                      }}
                    >
                      开始专注
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={!validTimeSpan(start, end)}
                    onClick={() => {
                      onSave(event.id, { title, note, startMin: start, endMin: end });
                    }}
                  >
                    保存
                  </Button>
                </div>
              </div>
          </div>
        ) : null}
      </PresenceDialog>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false);
        }}
        title="删除这个日程？"
        description="删除后无法恢复（日程没有回收站）。"
        danger
        confirmLabel="删除"
        onConfirm={() => {
          if (event !== undefined) {
            onDelete(event.id);
            onClose();
          }
        }}
      />
    </>
  );
}
