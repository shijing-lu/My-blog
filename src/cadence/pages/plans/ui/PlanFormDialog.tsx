/**
 * 新建 / 编辑计划
 *
 * 用 PresenceDialog（Radix 管无障碍 + 我们管动画）。
 * 表单状态刻意用局部 useState 而不是 Zustand —— 它是"写一半就丢"的临时状态，
 * 进全局 store 只会增加需要清理的地方。
 */

import { useState } from "react";

import type { Plan } from "@/cadence/entities/plan";
import type { PigmentKey } from "@/cadence/shared/config/pigment";
import { PIGMENT_KEYS } from "@/cadence/shared/config/pigment";
import { PresenceDialog } from "@/cadence/shared/motion";
import { Button } from "@/cadence/shared/ui/Button";
import { TextField } from "@/cadence/shared/ui/TextField";

import type { PlanDraft } from "@/cadence/features/plans";

interface PlanFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入即编辑，否则新建 */
  plan?: Plan | undefined;
  onSubmit: (draft: PlanDraft) => void;
}

export function PlanFormDialog({
  open,
  onOpenChange,
  plan,
  onSubmit,
}: PlanFormDialogProps) {
  const [title, setTitle] = useState(plan?.title ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [color, setColor] = useState<PigmentKey>(plan?.color ?? "plan");
  const [touched, setTouched] = useState(false);

  const trimmed = title.trim();
  const invalid = touched && trimmed.length === 0;

  const submit = () => {
    setTouched(true);
    if (trimmed.length === 0) return;
    onSubmit({
      title: trimmed,
      description: description.trim() === "" ? undefined : description.trim(),
      color,
    });
    if (plan === undefined) {
      setTitle("");
      setDescription("");
      setColor("plan");
      setTouched(false);
    }
    onOpenChange(false);
  };

  return (
    <PresenceDialog
      open={open}
      onOpenChange={onOpenChange}
      title={plan === undefined ? "新建计划" : "编辑计划"}
      description="计划是一个有始有终的目标容器；拆成任务之后进度会自动汇总。"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={submit}>
            {plan === undefined ? "创建" : "保存"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <TextField
          label="计划名称"
          value={title}
          placeholder="例如：完成季度复盘"
          error={invalid ? "名称不能为空" : undefined}
          onChange={(event) => setTitle(event.target.value)}
        />

        <TextField
          label="目标说明"
          value={description}
          placeholder="为什么要做这件事（可留空）"
          hint="想清楚动机，比列一堆任务更重要"
          wave="ripple"
          onChange={(event) => setDescription(event.target.value)}
        />

        <div>
          <p className="text-ink-3 mb-2 text-[11.5px] tracking-wide">
            颜色语义
          </p>
          <div className="flex flex-wrap gap-2">
            {PIGMENT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={key === color}
                aria-label={key}
                onClick={() => setColor(key)}
                className={[
                  "craft-transition-fast numeric rounded-[var(--radius-hand-sm)] px-3 py-1.5 text-[12px]",
                  key === color
                    ? "bg-paper-1 text-ink-1 shadow-[inset_0_0_0_1.5px_var(--color-amber-base)]"
                    : "hand-frame text-ink-3 hover:text-ink-1",
                ].join(" ")}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PresenceDialog>
  );
}
