/**
 * 滚动联动进度
 *
 * 约束（04 号文档 §5.4）：滚动联动只用于**视觉修饰**（透明度、轻微位移），
 * 不用于承载关键信息 —— 低端设备或禁用动效时它会被整体关闭。
 *
 * 实现上不自己监听 scroll 事件：Motion 内部的 useScroll 走 ScrollTimeline /
 * requestAnimationFrame，不会因滚动高频触发而重渲染 React 树。
 */

import { useScroll, useSpring, type MotionValue } from "motion/react";
import { useRef, type RefObject } from "react";

import { spring } from "../tokens";
import { useAdaptiveMotion } from "./useAdaptiveMotion";

export interface ScrollLinkedOptions {
  /** 容器；不传则监听窗口滚动 */
  container?: RefObject<HTMLElement | null>;
  /** 是否附加弹簧平滑（默认开启，让视觉修饰不跟手抖动） */
  smooth?: boolean;
}

/**
 * 返回 0–1 的滚动进度 MotionValue
 *
 * ⚠️ 返回的是 MotionValue，请配合 useTransform 使用，**不要**转成 state：
 *    滚动进度每秒变几十次，进 state 会直接把页面拖垮。
 */
export function useScrollLinkedProgress(
  options: ScrollLinkedOptions = {},
): MotionValue<number> {
  const { container, smooth = true } = options;
  const adaptive = useAdaptiveMotion();

  // useScroll 必须在每次渲染都调用（Hooks 规则），所以不能因为降级就跳过它。
  // 降级时返回的是一个恒为 0 的 MotionValue —— 调用方的 useTransform 依然成立，
  // 只是视觉效果不再随滚动变化。
  const scrollOptions = container
    ? ({ container, layoutEffect: false } as const)
    : undefined;
  const { scrollYProgress } = useScroll(scrollOptions);

  const smoothed = useSpring(scrollYProgress, spring.smooth);

  // 用 ref 固定返回值，避免降级状态在运行中变化导致 MotionValue 实例切换
  const fallbackRef = useRef<MotionValue<number> | null>(null);
  if (!fallbackRef.current) fallbackRef.current = scrollYProgress;

  if (adaptive.disableScrollLinked) return fallbackRef.current;
  return smooth ? smoothed : scrollYProgress;
}
