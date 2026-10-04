/**
 * 基础动画原型（L2 资产层 · primitives）
 * 依据：docs/04-动画系统设计规格.md §4.1、docs/05-…规范 §4.1（手作节奏）
 */

import type { Variants } from "motion/react";

import { distance, duration, ease, scaleFrom, spring } from "../tokens";

/** 淡入淡出 —— 通用、无位移。文字密集区与降级路径的兜底 */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: duration.base, ease: ease.decelerate },
  },
  exit: {
    opacity: 0,
    transition: { duration: duration.fast, ease: ease.accelerate },
  },
};

/**
 * 从下方升起 —— 无旋转版本
 * 与 placeOn 的分工：placeOn 带 ±1.2° 旋转，用于卡片、便利贴；
 * rise 用于**文字密集**的区块（旋转中的文字难以阅读）。
 */
export const rise: Variants = {
  hidden: { opacity: 0, y: distance.md },
  visible: { opacity: 1, y: 0, transition: spring.smooth },
  exit: {
    opacity: 0,
    y: -distance.sm,
    transition: { duration: duration.fast, ease: ease.accelerate },
  },
};

/** 缩放出现 —— 卡片、弹层 */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: scaleFrom.card },
  visible: { opacity: 1, scale: 1, transition: spring.smooth },
  exit: {
    opacity: 0,
    scale: scaleFrom.subtle,
    transition: { duration: duration.fast },
  },
};

/** 强调弹出 —— 新增成功、强调反馈 */
export const pop: Variants = {
  hidden: { opacity: 0, scale: scaleFrom.pop },
  visible: { opacity: 1, scale: 1, transition: spring.bouncy },
  exit: {
    opacity: 0,
    scale: scaleFrom.pop,
    transition: { duration: duration.instant },
  },
};

/**
 * 侧向滑入（参数化方向）
 * 返回单方向完整的 enter/exit 变体集合，避免调用方拼装。
 */
export function slide(direction: "left" | "right"): Variants {
  const sign = direction === "left" ? -1 : 1;
  return {
    hidden: { opacity: 0, x: sign * distance.lg },
    visible: { opacity: 1, x: 0, transition: spring.gentle },
    exit: {
      opacity: 0,
      x: sign * distance.md,
      transition: { duration: duration.fast, ease: ease.accelerate },
    },
  };
}

/**
 * 高度展开收起
 *
 * ⚠️ height: 'auto' 是唯一允许"动尺寸"的场景 —— Motion 内部用测量 + transform
 *    实现，不产生逐帧重排。其余尺寸变化一律用 layout（红线 R1）。
 *    手作版本请优先用 craft 里的 unwrap（带卷纸展开的旋转）。
 */
export const collapse: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: "auto",
    opacity: 1,
    transition: {
      height: spring.smooth,
      opacity: { duration: duration.fast, delay: 0.06 },
    },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: {
      opacity: { duration: duration.instant },
      height: { duration: duration.base, ease: ease.accelerate },
    },
  },
};
