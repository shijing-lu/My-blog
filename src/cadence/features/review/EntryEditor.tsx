/**
 * 复盘条目编辑器（features 层组件）
 * ---------------------------------------------------------------------------
 * 复盘页与执行页共用：执行页在专注结束后自动弹出本编辑器，
 * 预填刚结束的时间段（联动需求）。放在 features 而不是 pages 里，
 * 否则 pages→pages 的跨切片引用会被分层守卫拦下。
 */

import { useState } from "react";

import type {
  ReviewEntry,
  ReviewSchedule,
  Slot,
} from "@/cadence/entities/review";
import { clockOf, localTzOffsetMinutes } from "@/cadence/shared/db/time";
import {
  AnimatePresence,
  HandRule,
  m,
  useResolvedVariants,
} from "@/cadence/shared/motion";
import {
  backdrop,
  modalPanel,
} from "@/cadence/shared/motion/variants/surfaces";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { TextField } from "@/cadence/shared/ui/TextField";

const MOOD_FACES = ["😖", "😕", "😐", "🙂", "😄"] as const;

export interface EditingTarget {
  schedule: ReviewSchedule;
  slot: Slot;
  entry?: ReviewEntry;
}

export function EntryEditor({
  target,
  onClose,
  onSave,
  onDelete,
}: {
  target: EditingTarget | undefined;
  onClose: () => void;
  onSave: (
    schedule: ReviewSchedule,
    slot: Slot,
    draft: { content: string; mood?: number | undefined },
    entryId?: string,
  ) => Promise<void>;
  onDelete: (entryId: string) => Promise<void>;
}) {
  const backdropVariants = useResolvedVariants(backdrop);
  const panelVariants = useResolvedVariants(modalPanel);

  const [content, setContent] = useState("");
  const [mood, setMood] = useState<number | undefined>(undefined);
  const [hydratedFor, setHydratedFor] = useState("");

  // 打开（或切换目标格子）时用现有条目初始化。
  // 以格子为 hydration 键：输入中途 useLiveQuery 刷新不会重置正在编辑的内容
  const hydrationKey =
    target === undefined
      ? ""
      : (target.entry?.id ?? `slot-${target.slot.start}`);
  if (target !== undefined && hydrationKey !== hydratedFor) {
    setContent(target.entry?.content ?? "");
    setMood(target.entry?.mood);
    setHydratedFor(hydrationKey);
  }

  return (
    <AnimatePresence>
      {target !== undefined ? (
        <m.div
          key="review-editor"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-[var(--scrim)]"
          onClick={onClose}
        >
          <m.div
            variants={panelVariants}
            className="surface-card w-[min(480px,92vw)] p-6"
            onClick={(event) => event.stopPropagation()}
            style={{ borderRadius: "var(--radius-hand-lg)" }}
          >
            <p className="text-ink-4 numeric text-[11px]">
              {target.schedule.title} ·{" "}
              {clockOf(target.slot.start, localTzOffsetMinutes())} –{" "}
              {clockOf(target.slot.end, localTzOffsetMinutes())}
            </p>
            <h3 className="text-ink-1 mt-1 font-serif text-lg">
              {target.schedule.prompt ?? "这一格发生了什么？"}
            </h3>
            <HandRule shape="gentle" className="my-3" />

            <TextField
              label="复盘内容"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="如实记录，不评价自己"
              multiline
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void onSave(
                    target.schedule,
                    target.slot,
                    { content, mood },
                    target.entry?.id,
                  );
                }
              }}
            />

            <div className="mt-4">
              <p className="text-ink-3 text-[11.5px]">此刻心情</p>
              <div className="mt-1.5 flex gap-1.5">
                {MOOD_FACES.map((face, index) => {
                  const value = index + 1;
                  return (
                    <button
                      key={face}
                      type="button"
                      aria-pressed={mood === value}
                      aria-label={`心情 ${value} / 5`}
                      onClick={() =>
                        setMood(mood === value ? undefined : value)
                      }
                      className={[
                        "craft-transition-fast grid h-10 w-10 place-items-center rounded-full text-[19px]",
                        mood === value
                          ? "bg-amber-soft shadow-[inset_0_0_0_2px_var(--color-amber-base)]"
                          : "opacity-55 hover:opacity-100",
                      ].join(" ")}
                    >
                      {face}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              {target.entry ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void onDelete(target.entry!.id)}
                >
                  删除
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-3">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void onSave(
                      target.schedule,
                      target.slot,
                      { content, mood },
                      target.entry?.id,
                    ).catch((error: unknown) =>
                      toast.error(
                        error instanceof Error ? error.message : "保存失败",
                      ),
                    );
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
