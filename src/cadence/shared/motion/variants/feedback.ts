/**
 * 反馈类动画（L2 资产层 · feedback）
 * 勾选、完成、进度、计时指示。
 */

import type { Variants } from "motion/react";

import { duration, ease } from "../tokens";

/**
 * 勾选：先压后弹
 * 高频操作，因此保持快速（360ms）—— 属于"操作动效"档。
 */
export const checkPop: Variants = {
  unchecked: { scale: 1 },
  checked: {
    scale: [1, 0.86, 1.12, 1],
    transition: {
      duration: 0.36,
      times: [0, 0.3, 0.65, 1],
      ease: ease.overshoot,
    },
  },
};

/**
 * 勾选图标路径绘制
 * 与 checkPop 配合：外框先弹，勾形随后"写"出来。
 */
export const checkPath: Variants = {
  unchecked: { pathLength: 0, opacity: 0 },
  checked: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: 0.2, ease: ease.decelerate, delay: 0.06 },
    },
  },
};

/**
 * 任务完成：卡片向内收拢并轻微脉冲，随后由列表退出动画接管
 * 配合 stampIn 使用：先盖印，再脉冲，最后退出列表。
 */
export const completeCard: Variants = {
  active: { scale: 1, opacity: 1 },
  completing: {
    scale: [1, 0.985, 1],
    opacity: [1, 0.7, 1],
    transition: { duration: 0.32, ease: ease.standard },
  },
};

/**
 * 呼吸指示点（通用版本）
 * 手作风格下"计时中"优先用 craft 的 wobble（烛火摇曳）；
 * 本变体保留给中性场景（加载、同步中）。
 */
export const pulse: Variants = {
  idle: { scale: 1, opacity: 0.6 },
  active: {
    scale: [1, 1.35, 1],
    opacity: [0.6, 1, 0.6],
    transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
  },
};

/**
 * 进度环 / 进度条填充
 * value 为 0–1 的目标进度。
 */
export function progressFill(value: number): Variants {
  const clamped = Math.min(1, Math.max(0, value));
  return {
    hidden: { strokeDashoffset: 1, opacity: 0 },
    visible: {
      strokeDashoffset: 1 - clamped,
      opacity: 1,
      transition: { duration: duration.deliberate, ease: ease.decelerate },
    },
  };
}
