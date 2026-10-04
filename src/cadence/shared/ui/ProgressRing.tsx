/**
 * 进度环（毛笔描边）
 * ---------------------------------------------------------------------------
 * 手作化处理：
 *   1. 底层是纸的满环，上层是颜料色被"描"出来的弧（drawIn 原理：pathLength）
 *   2. 端头用 strokeLinecap="round" —— 像毛笔收笔的圆头，而不是被切断的直角
 *   3. 中心数字用 AnimatedNumber：滚动期间直接改 textContent，不重渲染
 *
 * 颜色通过 pigment 语义传入而非任意色值 —— 色值只允许出现在 tokens.css
 * 与 shared/config/pigment.ts，ESLint 会拦截其他位置的色值字面量。
 */

import { AnimatedNumber, m, useResolvedMotion } from "@/cadence/shared/motion";
import { SEMANTIC_PIGMENT } from "@/cadence/shared/config/pigment";
import { duration, ease } from "@/cadence/shared/motion";

export type RingSemantic = keyof typeof SEMANTIC_PIGMENT;

interface ProgressRingProps {
  /** 0–100 */
  value: number;
  size?: number;
  thickness?: number;
  semantic?: RingSemantic;
  /** 中心文字：默认显示百分比；传 null 隐藏 */
  centerLabel?: string | null;
  /** 中心数值的小数位 */
  decimals?: number;
  className?: string;
}

export function ProgressRing({
  value,
  size = 96,
  thickness = 8,
  semantic = "plan",
  centerLabel,
  decimals = 0,
  className,
}: ProgressRingProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - thickness) / 2;
  const color = SEMANTIC_PIGMENT[semantic].base;

  // 描边动画：drawIn 的判定原则 —— 信息性动画，reduced-motion 下保留（压缩时长）
  const transition = useResolvedMotion({
    duration: duration.deliberate,
    ease: ease.decelerate,
  });

  return (
    <div
      className={["relative shrink-0", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`进度 ${Math.round(clamped)}%`}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
      >
        {/* 纸的满环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-paper-line)"
          strokeWidth={thickness}
        />
        {/* 颜料色弧线：pathLength 0 → 目标值 */}
        <m.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: clamped / 100, opacity: 1 }}
          transition={transition}
        />
      </svg>

      {centerLabel === null ? null : (
        <span className="text-ink-1 absolute inset-0 grid place-items-center font-serif text-[19px]">
          {centerLabel ?? (
            <AnimatedNumber value={clamped} decimals={decimals} suffix="%" />
          )}
        </span>
      )}
    </div>
  );
}

/**
 * 双维度进度：完成率 + 时长比
 * 计划模块的核心指标 —— 只看到"做完了 60%"是不够的，
 * 还要看到"只花了预估时间的 40%"，两个维度一起才说明节奏是否健康。
 */
export function DualProgressRing({
  completion,
  timeRatio,
  size = 108,
  className,
}: {
  completion: number;
  timeRatio: number;
  size?: number;
  className?: string;
}) {
  const completionTransition = useResolvedMotion({
    duration: duration.deliberate,
    ease: ease.decelerate,
  });
  const timeTransition = useResolvedMotion({
    duration: duration.slow,
    ease: ease.decelerate,
  });

  // 外环记完成率，内环记"实际投入 / 预估"。两环之间留 10px，避免笔触视觉粘连
  const OUTER_STROKE = 7;
  const INNER_STROKE = 5;
  const outerR = (size - OUTER_STROKE) / 2;
  const innerR = outerR - 10;

  const outerPath = `rotate(-90 ${size / 2} ${size / 2})`;

  return (
    <div
      className={["relative shrink-0", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
      >
        {/* 两层纸的底环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={outerR}
          fill="none"
          stroke="var(--color-paper-line)"
          strokeWidth={OUTER_STROKE}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={innerR}
          fill="none"
          stroke="var(--color-paper-line)"
          strokeWidth={INNER_STROKE}
        />

        {/* 外环：完成率（琥珀 · 计划） */}
        <m.circle
          cx={size / 2}
          cy={size / 2}
          r={outerR}
          fill="none"
          stroke={SEMANTIC_PIGMENT.plan.base}
          strokeWidth={OUTER_STROKE}
          strokeLinecap="round"
          transform={outerPath}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.min(1, Math.max(0, completion / 100)) }}
          transition={completionTransition}
        />
        {/* 内环：实际投入 / 预估（赭石 · 中性度量） */}
        <m.circle
          cx={size / 2}
          cy={size / 2}
          r={innerR}
          fill="none"
          stroke={SEMANTIC_PIGMENT.archive.base}
          strokeWidth={INNER_STROKE}
          strokeLinecap="round"
          transform={outerPath}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.min(1, Math.max(0, timeRatio / 100)) }}
          transition={timeTransition}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        <AnimatedNumber
          value={completion}
          suffix="%"
          className="text-ink-1 font-serif text-[20px] leading-none"
        />
      </span>
    </div>
  );
}
