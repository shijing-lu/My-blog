/**
 * 表面类动画（L2 资产层 · surfaces）
 * 页面转场、模态、抽屉、Toast。
 */

import type { Variants } from "motion/react";

import { distance, duration, ease, scaleFrom, spring } from "../tokens";

/** 页面转场：前进（下钻到更深的层级） */
export const pageForward: Variants = {
  hidden: { opacity: 0, x: distance.xl * 0.6 },
  visible: { opacity: 1, x: 0, transition: spring.gentle },
  exit: {
    opacity: 0,
    x: -distance.lg * 0.6,
    transition: { duration: duration.base, ease: ease.accelerate },
  },
};

/** 页面转场：后退 */
export const pageBack: Variants = {
  hidden: { opacity: 0, x: -distance.xl * 0.6 },
  visible: { opacity: 1, x: 0, transition: spring.gentle },
  exit: {
    opacity: 0,
    x: distance.lg * 0.6,
    transition: { duration: duration.base, ease: ease.accelerate },
  },
};

/**
 * 页面转场：同级切换（一级导航之间）
 * 只做淡入 + 极轻微上移 —— 加方向性位移会误导用户"层级变了"。
 */
export const pageLateral: Variants = {
  hidden: { opacity: 0, y: distance.xs },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: ease.decelerate },
  },
  exit: {
    opacity: 0,
    y: -distance.xs,
    transition: { duration: duration.fast, ease: ease.accelerate },
  },
};

/** 模态面板 */
export const modalPanel: Variants = {
  hidden: { opacity: 0, scale: scaleFrom.panel, y: distance.sm },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring.gentle },
  exit: {
    opacity: 0,
    scale: scaleFrom.card,
    y: distance.xs,
    transition: { duration: duration.fast, ease: ease.accelerate },
  },
};

/**
 * 遮罩
 * 用暖褐半透明而非纯黑 —— 纯黑遮罩在米黄纸面上会显出冷灰，破坏整体暖调。
 */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.base } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

/** 侧边抽屉 */
export const drawerRight: Variants = {
  hidden: { x: "100%" },
  visible: { x: 0, transition: spring.gentle },
  exit: {
    x: "100%",
    transition: { duration: duration.base, ease: ease.accelerate },
  },
};

/** 底部面板（移动端） */
export const sheetBottom: Variants = {
  hidden: { y: "100%" },
  visible: { y: 0, transition: spring.gentle },
  exit: {
    y: "100%",
    transition: { duration: duration.base, ease: ease.accelerate },
  },
};

/** Toast —— 像一张递过来的便签 */
export const toast: Variants = {
  hidden: { opacity: 0, y: distance.lg, scale: scaleFrom.card },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.smooth },
  exit: {
    opacity: 0,
    y: distance.sm,
    scale: scaleFrom.subtle,
    transition: { duration: duration.fast },
  },
};
