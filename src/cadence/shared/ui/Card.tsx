/**
 * 纸卡（手作化容器）
 *
 * 手作语汇：这是一张**放在案台上的纸**。
 *   默认态 —— 顶部 1px 高光（受光面）+ 近距离接触阴影
 *   悬停   —— 被气流微微抬起 2px，投影扩散
 *   按下   —— 出现 inset 压痕，像手指按在纸上
 *
 * 底色的可选项收敛为枚举而非外部 className：
 * 两个 bg-* 工具类争同一属性时，谁生效取决于样式表顺序而非书写顺序，
 * 属不可控隐患（M0 踩过这个坑）。
 */

import type { ReactNode } from "react";

const TONE_CLASS = {
  paper: "bg-paper-1",
  inset: "bg-paper-2",
  mark: "bg-paper-mark",
  plan: "bg-amber-soft",
  session: "bg-clay-soft",
  done: "bg-forest-soft",
  todo: "bg-craft-soft",
  review: "bg-fabric-soft",
  archive: "bg-ochre-soft",
} as const;

export type CardTone = keyof typeof TONE_CLASS;

interface CardProps {
  children: ReactNode;
  tone?: CardTone;
  /** 交互型卡片（可点击/拖拽）：启用抬起与压痕反馈 */
  interactive?: boolean;
  className?: string;
}

export function Card({
  children,
  tone = "paper",
  interactive = false,
  className,
}: CardProps) {
  return (
    <div
      data-m3-role="card"
      data-m3-tone={tone}
      data-m3-interactive={interactive || undefined}
      className={[
        "surface-card p-5",
        TONE_CLASS[tone],
        interactive ? "surface-card-hover" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/** 卡片头部：标题 + 右侧附注/操作，保证全站卡片头部结构一致 */
export function CardHeader({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div data-m3-role="card-header" className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[15px]">{title}</h3>
      <div className="flex items-center gap-2">
        {hint ? <span className="text-ink-3 text-[11px]">{hint}</span> : null}
        {action}
      </div>
    </div>
  );
}
