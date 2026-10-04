/**
 * 手绘分隔线 / 下划线
 * 依据：docs/05-视觉风格与手作动效规范.md §3.2（1）
 *
 * 三条纪律：
 *   1. 曲线**固定写死**，不用随机生成 —— 否则每次渲染都不同，且无法做视觉回归
 *   2. 描边宽度 1.5–2px：过细显得脆弱，过粗显得笨重
 *   3. 振幅 ≤ 3px（400px 宽度下）：过大像"手抖"而不是"手绘"
 *
 * `preserveAspectRatio="none"` 让同一条曲线可以拉伸到任意宽度，
 * `vector-effect="non-scaling-stroke"` 保证拉伸时描边粗细不变 ——
 * 两者缺一，横向拉伸后笔触就会变形。
 */

import { m } from "motion/react";
import type { SVGProps } from "react";

import { drawIn } from "../variants/craft";

/** 三条预设曲线：单波、双波、缓波。形状固定，不随机。 */
const PATHS = {
  wave: "M2 5.2C42 3.1 78 6.8 118 4.6S196 2.4 238 5.4 322 7.2 398 3.9",
  ripple: "M2 4.4C58 6.6 96 2.8 142 5.1S232 7.4 286 4.2 356 2.6 398 5.6",
  gentle: "M2 4.2C54 6.4 96 2.6 140 4.9S228 7 282 4.1 354 2.4 398 5.2",
} as const;

export type HandRuleShape = keyof typeof PATHS;

interface HandRuleProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  shape?: HandRuleShape;
  /** 用笔触自绘动画入场（drawIn）。仅在需要强调时开启。 */
  animate?: boolean;
  /** 颜色：默认用纸的线色；标记色用于强调 */
  tone?: "line" | "mark";
}

export function HandRule({
  shape = "wave",
  animate = false,
  tone = "line",
  className,
  style,
  ...rest
}: HandRuleProps) {
  const stroke =
    tone === "mark" ? "var(--color-amber-base)" : "var(--color-paper-line)";

  return (
    <svg
      viewBox="0 0 400 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={["block w-full", className].filter(Boolean).join(" ")}
      style={{ height: 6, ...style }}
      {...rest}
    >
      <m.path
        d="M2 4H398"
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        {...(animate
          ? { variants: drawIn, initial: "hidden", animate: "visible" }
          : {})}
      />
    </svg>
  );
}
