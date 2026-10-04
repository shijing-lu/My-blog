/**
 * 文本输入（手作化）
 * ---------------------------------------------------------------------------
 * 手作化处理：不用四边方框，改为**底部一条手绘波浪线** ——
 * 像在纸上划出一条横格线来写字。
 *
 * 聚焦时波浪线用 620ms 重新"描"一遍。这条动画是信息性的
 * （它在说"现在可以在这里写字了"），因此 reduced-motion 下保留、压缩时长。
 * 绘制由 CSS 驱动（.hand-underline + .peer），见 app/styles/base.css ——
 * 纯视觉提示没必要参与 React 渲染。
 *
 * ⚠️ DOM 结构约束：<input> 必须带 .peer 且排在手绘线之前，
 *    因为 peer 选择器编译为"后续兄弟"语义。
 *
 * 无障碍：label 与错误提示通过 id 关联；错误态同时输出文字，不只靠变红。
 */

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id"
> {
  label: string;
  /** 多行模式：渲染 textarea 而不是 input（rows 仅在多行下生效） */
  multiline?: boolean;
  /** 帮助文本（常态显示） */
  hint?: ReactNode;
  /** 错误文本；提供时进入错误态 */
  error?: ReactNode;
  /** 隐藏 label 的视觉呈现，但保留给屏幕阅读器 */
  hideLabel?: boolean;
  /** 波浪线形状，各表单错开可避免视觉雷同 */
  wave?: "wave" | "ripple" | "gentle";
  className?: string;
}

/** 多行模式的专属属性（rows 不属于 input） */
type TextFieldMultilineProps = TextFieldProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "rows"> & {
    rows?: number;
  };

const WAVE_PATHS = {
  wave: "M2 4.6C46 6.9 88 2.4 132 4.9S220 7.2 268 4.3 352 2.8 398 5.4",
  ripple: "M2 5C58 2.8 104 6.6 152 4.4S244 2.2 296 5.2 362 7 398 4.2",
  gentle: "M2 4.4C54 6.6 100 3 146 5.1S232 6.9 288 4.5 356 2.9 398 5.3",
} as const;

export function TextField({
  label,
  multiline = false,
  hint,
  error,
  hideLabel = false,
  wave = "wave",
  className,
  ...rest
}: TextFieldMultilineProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const hasError = Boolean(error);
  const describedBy = [hint ? hintId : null, hasError ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={["relative pb-3", className].filter(Boolean).join(" ")}>
      <label
        htmlFor={inputId}
        className={
          hideLabel
            ? "sr-only"
            : "text-ink-3 mb-1 block text-[11.5px] tracking-wide"
        }
      >
        {label}
      </label>

      {multiline ? (
        <textarea
          id={inputId}
          rows={3}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy || undefined}
          className="peer text-foreground placeholder:text-muted-foreground w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={inputId}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy || undefined}
          className="peer text-foreground placeholder:text-muted-foreground w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}

      {/* 底部手绘线：聚焦时重描一遍 + 转为强调色 */}
      <svg
        viewBox="0 0 400 8"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-error={hasError ? "true" : undefined}
        className={[
          "hand-underline absolute inset-x-0 bottom-0 h-[7px] w-full",
          "transition-colors duration-[var(--dur-base)] ease-[var(--ease-standard)]",
          hasError ? "text-clay-base" : "text-paper-line",
        ].join(" ")}
      >
        <path
          d={WAVE_PATHS[wave]}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {hint ? (
        <p id={hintId} className="text-ink-3 mt-1.5 text-[11.5px]">
          {hint}
        </p>
      ) : null}

      {hasError ? (
        <p id={errorId} className="text-clay-deep mt-1.5 text-[11.5px]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
