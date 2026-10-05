/**
 * 标签（颜料语义色）
 * ---------------------------------------------------------------------------
 * 手作化处理：soft 档做底 + deep 档做字，保证对比度 ≥ 4.5:1。
 * 新增时用 smudge 晕开（"颜色在纸上扩散"），这是 M1 的 craft 原型之一。
 *
 * 底色收敛为受控枚举而非外部 className —— 理由同 Card：
 * 两个 bg-* 工具类争同一属性时，谁生效取决于样式表顺序。
 */

import type { ReactNode } from "react";

import type { PigmentKey } from "@/cadence/shared/config/pigment";
import { m, smudgeLite } from "@/cadence/shared/motion";

type TagTone = PigmentKey | "neutral";

const TONE_CLASS: Record<TagTone, string> = {
  plan: "bg-amber-soft text-amber-deep",
  session: "bg-clay-soft text-clay-deep",
  done: "bg-forest-soft text-forest-deep",
  todo: "bg-craft-soft text-craft-deep",
  review: "bg-fabric-soft text-fabric-deep",
  archive: "bg-ochre-soft text-ochre-deep",
  neutral: "bg-paper-2 text-ink-3",
};

interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  /** 左侧色点：颜色不作为唯一信息载体，色点只是强化 */
  dot?: boolean;
  className?: string;
}

export function Tag({
  children,
  tone = "neutral",
  dot = false,
  className,
}: TagProps) {
  return (
    <span
      data-m3-role="badge"
      data-m3-tone={tone}
      className={[
        "inline-flex items-center gap-1.5 rounded-[var(--radius-hand-sm)] px-2.5 py-1 text-[12px] font-medium",
        TONE_CLASS[tone],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * 新出现的标签：用 smudge 晕开
 * 与静态 Tag 分开，避免所有标签在列表滚动时都触发一次动画。
 */
export function TagAppearing({
  children,
  tone = "neutral",
  className,
}: Omit<TagProps, "dot">) {
  return (
    <m.span
      data-m3-role="badge"
      data-m3-tone={tone}
      variants={smudgeLite}
      initial="hidden"
      animate="visible"
      className={[
        "inline-flex items-center rounded-[var(--radius-hand-sm)] px-2.5 py-1 text-[12px] font-medium",
        TONE_CLASS[tone],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </m.span>
  );
}

export type { TagTone };
