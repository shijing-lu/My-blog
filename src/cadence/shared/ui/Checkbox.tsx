/**
 * 复选框（手绘勾）
 * ---------------------------------------------------------------------------
 * 手作化处理：勾形不是"切换显示"，而是被**一笔画出来**的（pathLength 0→1）。
 *
 * ♿ 无障碍判定：这条绘制动画属于**信息性**而非装饰性
 *    （它表达"这个动作正在完成"），因此在 prefers-reduced-motion 下保留，
 *    只是压缩时长。与 drawIn 的判定原则一致（04 号文档 §7.1）。
 *
 * 外框先"弹"一下（checkPop），勾形随后写出 —— 两个动作错开 60ms 才有
 * "落笔"的层次感；同步播放会显得敷衍。
 *
 * ⚠️ DOM 结构约束：<input> 与样式化的外框必须是**兄弟节点**，且 input 在前。
 *    Tailwind 的 peer-* 编译为 `.peer:focus-visible ~ .peer-focus-visible\:*`，
 *    是"后续兄弟"选择器 —— 若外框是 label 的后代而不是 input 的兄弟，
 *    键盘焦点环就完全不生效（且不会有任何报错）。
 */

import { useId, type ReactNode } from "react";

import {
  checkPath,
  checkPop,
  m,
  useResolvedVariants,
} from "@/cadence/shared/motion";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
  /** 无 children 时的无障碍标签 */
  label?: string;
  className?: string;
}

export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
  label,
  className,
}: CheckboxProps) {
  const inputId = useId();
  const popVariants = useResolvedVariants(checkPop);
  const pathVariants = useResolvedVariants(checkPath);
  const state = checked ? "checked" : "unchecked";

  return (
    <label
      className={[
        "flex items-start gap-2.5 select-none",
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        id={inputId}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={children ? undefined : label}
        onChange={(event) => onChange(event.target.checked)}
      />

      {/* 外框：手绘圆角 + 弹一下。必须是 input 的后续兄弟才能吃到 peer-focus-visible */}
      <m.span
        aria-hidden="true"
        variants={popVariants}
        initial={false}
        animate={state}
        className={[
          "mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center",
          "rounded-[6px_3px_7px_4px/4px_7px_3px_6px]",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-amber-deep",
          checked
            ? "bg-paper-mark shadow-[inset_0_0_0_1.8px_var(--color-amber-base)]"
            : "bg-paper-1 shadow-[inset_0_0_0_1.8px_var(--color-paper-line)]",
        ].join(" ")}
      >
        <svg viewBox="0 0 20 20" width={15} height={15} aria-hidden="true">
          <m.path
            d="M4 10.5 L8.2 15 L16 5.6"
            fill="none"
            stroke="var(--color-amber-deep)"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            variants={pathVariants}
            initial={false}
            animate={state}
          />
        </svg>
      </m.span>

      {children ? (
        <span
          className={[
            "text-[14px] leading-snug",
            checked
              ? "text-ink-3 decoration-ink-4 line-through decoration-[1.5px]"
              : "text-ink-2",
          ].join(" ")}
        >
          {children}
        </span>
      ) : null}
    </label>
  );
}
