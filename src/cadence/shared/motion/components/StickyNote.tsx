/**
 * 便利贴（待办卡片的视觉载体）
 * 依据：docs/05-视觉风格与手作动效规范.md §3.5
 *
 * 两个关键设计：
 *   1. 倾斜角由实体 id **确定性派生**（tiltOf），不是随机的。
 *      同一张纸条永远同一个角度 —— 这是"贴纸"与"屏幕在抖"的区别（红线 C6）。
 *   2. 底色用**受限的 tone 枚举**而不是外部传 className。
 *      原因：Tailwind 同一个属性（background-color）的两个工具类谁生效取决于
 *      样式表顺序，而不是 JSX 里的书写顺序。外部传 bg-* 会与组件内置的
 *      bg-paper-1 产生不可预测的冲突，所以把可选值收敛成枚举。
 *
 * 拖拽时旋转归零：调用方把 `lifted` 设为 true，视觉上表达"拿起来了"。
 * 完整拖拽交互在 M6 的 todo-axis-board 中。
 */

import type { ReactNode } from "react";

import { rotation } from "../tokens";
import { tiltOf } from "@/cadence/shared/lib/tilt";

/** 便利贴底色（对应象限语义与中性场景） */
const TONE_CLASS = {
  paper: "bg-paper-1",
  mark: "bg-paper-mark",
  plan: "bg-amber-soft",
  session: "bg-clay-soft",
  done: "bg-forest-soft",
  todo: "bg-craft-soft",
  review: "bg-fabric-soft",
  archive: "bg-ochre-soft",
} as const;

export type StickyTone = keyof typeof TONE_CLASS;

const SIZE_CLASS = {
  compact: "px-2.5 py-1.5 text-[11px]",
  normal: "px-3.5 py-3 text-[13.5px]",
} as const;

export type StickySize = keyof typeof SIZE_CLASS;

interface StickyNoteBaseProps {
  /** 实体 id —— 决定倾斜角，必须稳定 */
  id: string;
  children: ReactNode;
  tone?: StickyTone;
  size?: StickySize;
  /** 额外的布局类（宽度、外边距等）。不要传 bg-* 或 padding/text-size。 */
  className?: string;
  /** 覆盖倾斜幅度上限；XY 看板应传 rotation.board（±1.0°） */
  maxTilt?: number;
}

/**
 * 便利贴基础类
 *
 * ⚠️ 这里**故意不包含 background-color** —— 底色由 TONE_CLASS 提供。
 *    若把纸色写进这里，调用方传的 bg-* 就会和它争同一个属性，
 *    而谁生效取决于样式表顺序而非书写顺序，属于不可控的隐患。
 */
function baseClasses(
  tone: StickyTone,
  size: StickySize,
  className: string | undefined,
  willChange: boolean,
): string {
  return [
    "sticky-surface text-ink-1",
    TONE_CLASS[tone],
    SIZE_CLASS[size],
    willChange ? "will-change-transform" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 静态便利贴：无交互，无 transition 开销 */
export function StickyNoteStatic({
  id,
  children,
  tone = "mark",
  size = "normal",
  className,
  maxTilt = rotation.card,
}: StickyNoteBaseProps) {
  return (
    <div
      className={baseClasses(tone, size, className, false)}
      style={{ transform: `rotate(${tiltOf(id, maxTilt).toFixed(3)}deg)` }}
    >
      {children}
    </div>
  );
}

interface StickyNoteProps extends StickyNoteBaseProps {
  /** 抬起状态（拖拽中 / 悬停）：旋转归零、阴影加深 */
  lifted?: boolean;
}

/** 可交互便利贴：带旋转与阴影过渡；拖拽时传 lifted */
export function StickyNote({
  id,
  children,
  tone = "mark",
  size = "normal",
  className,
  lifted = false,
  maxTilt = rotation.card,
}: StickyNoteProps) {
  const tilt = lifted ? 0 : tiltOf(id, maxTilt);

  return (
    <div
      className={baseClasses(tone, size, className, true)}
      style={{
        transform: `rotate(${tilt.toFixed(3)}deg)`,
        // 抬起时用更深的投影表达"离开了纸面"
        boxShadow: lifted
          ? "inset 0 1px 0 0 rgb(255 255 255 / 55%), 0 3px 6px -2px var(--paper-shadow), 0 14px 26px -12px var(--paper-shadow)"
          : undefined,
      }}
    >
      {children}
    </div>
  );
}
