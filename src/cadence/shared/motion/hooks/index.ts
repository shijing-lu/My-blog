/**
 * 动画系统 Hook 出口（L2 资产层）
 *
 * 业务组件通过这一层拿动效参数与编排能力，不直接接触 motion 库、
 * 也不自己判断降级。
 */

import { useMemo } from "react";
import type { Transition, Variants } from "motion/react";

import { useMotionStrength } from "@/cadence/shared/store/appearance-store";
import {
  resolveMotion,
  resolveVariants,
  staggerInterval,
  staggerTotal,
} from "../utils";

export { useMotionStrength };

/** 按当前动效强度解析一个 transition */
export function useResolvedMotion(transition: Transition): Transition {
  const strength = useMotionStrength();
  return useMemo(
    () => resolveMotion(transition, strength),
    [transition, strength],
  );
}

/** 按当前动效强度解析整套变体（off 档会压成瞬时切换） */
export function useResolvedVariants(variants: Variants): Variants {
  const strength = useMotionStrength();
  return useMemo(
    () => resolveVariants(variants, strength),
    [variants, strength],
  );
}

/**
 * 按子元素数量计算受上限约束的交错间隔
 * 返回 0 表示不启用交错。
 */
export function useStaggerTiming(
  count: number,
  base?: number,
): { interval: number; total: number } {
  return useMemo(() => {
    const interval = staggerInterval(count, base);
    return { interval, total: staggerTotal(count, base) };
  }, [count, base]);
}

/* ── 自适应降级 ── */
export {
  shouldPauseAmbient,
  useAdaptiveMotion,
  type AdaptiveMotionConfig,
} from "./useAdaptiveMotion";

/* ── 数字滚动 ── */
export {
  DEFAULT_ANIMATED_NUMBER,
  formatAnimatedNumber,
  useAnimatedNumber,
  type AnimatedNumberOptions,
} from "./useAnimatedNumber";

/* ── 拖拽提交 ── */
export {
  clamp,
  toNormalizedPoint,
  useDragCommit,
  type DragCommitHandlers,
  type DragCommitOptions,
  type DragCommitPoint,
} from "./useDragCommit";

/* ── 滚动联动 ── */
export {
  useScrollLinkedProgress,
  type ScrollLinkedOptions,
} from "./useScrollLinkedProgress";

/* ── 帧率计量（仅 /motion-lab 使用） ── */
export { useFpsMeter, type FpsStats } from "./useFpsMeter";
