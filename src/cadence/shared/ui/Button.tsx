/**
 * 按钮（手作化）
 * ---------------------------------------------------------------------------
 * 三种形态，手作感来自**压痕与描边**，而不是阴影与渐变：
 *   primary  琥珀 deep 档实底 —— 对米白文字 8.6:1，按下出现 inset 压痕
 *   ghost    透明底 + 手绘描边，悬停时第二层描边淡入（"再描一遍"）
 *   danger   陶土 deep 档实底
 *
 * 为什么不用圆角矩形 + 浮起阴影：那是"现代 UI"的语言。
 * 手作语汇里，按钮更像一枚被按进纸面的印章 —— 所以按下的是**凹陷**而非浮起。
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { m, useReducedMotion } from "@/cadence/shared/motion";

type ButtonVariant = "primary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 左侧图标（如 lucide 图标元素） */
  icon?: ReactNode;
  /** 加载中：禁用交互并显示手绘下划线扫描动画 */
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  ghost:
    "hand-frame text-ink-2 hover:text-ink-1 hover:bg-paper-2 active:shadow-[inset_0_2px_6px_-2px_var(--paper-shadow)]",
  danger: "bg-destructive text-white hover:bg-destructive/90",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-[12.5px]",
  md: "px-5 py-2.5 text-sm",
};

/**
 * 手绘加载指示：一小段被反复"描"出来的弧线
 *
 * 是**线性、低刺激**的动画，因此 reduced-motion 下保留（只是不再循环，
 * 改为静态弧线）—— 与 drawIn 的判定原则一致：承载进度信息的不移除。
 */
function HandSpinner() {
  const prefersReduced = useReducedMotion();

  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      aria-hidden="true"
      className="shrink-0"
    >
      <m.circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="26 12"
        // 用 false 而不是 undefined 关闭动画：
        // exactOptionalPropertyTypes 下显式传 undefined 不是合法赋值，
        // 而 motion 的 animate 联合类型里本身包含 boolean
        animate={prefersReduced ? false : { rotate: 360 }}
        transition={
          prefersReduced
            ? { duration: 0 }
            : { duration: 1.4, repeat: Infinity, ease: "linear" }
        }
        style={{ transformOrigin: "8px 8px" }}
      />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "craft-transition-fast inline-flex items-center justify-center gap-2 font-medium",
        "rounded-[var(--radius-hand-pill)]",
        "active:translate-y-px",
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        isDisabled ? "cursor-not-allowed opacity-45" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <HandSpinner />
      ) : icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
