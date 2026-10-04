/**
 * 集合类动画（L2 资产层 · collections）
 * 用于列表、网格、树的增删与交错入场。
 */

import type { Variants } from "motion/react";

import {
  distance,
  duration,
  ease,
  scaleFrom,
  spring,
  stagger,
} from "../tokens";

/**
 * 列表容器 —— 只负责编排子元素的交错，自身不动
 * 间隔由调用方经 staggerInterval() 计算后传入，以自动受上限约束。
 */
export function listContainer(interval: number = stagger.base): Variants {
  return {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: interval, delayChildren: 0.02 },
    },
    exit: {
      opacity: 1,
      transition: { staggerChildren: interval * 0.6, staggerDirection: -1 },
    },
  };
}

/**
 * 列表项 —— 入场从下升起，出场向左收起
 *
 * ⚠️ 配合 AnimatePresence 时必须用 mode="popLayout"：
 *    退出元素脱离文档流，其余元素立即让位，否则会出现抽动。
 * ⚠️ 虚拟化列表中禁止使用本变体（红线 R4）：虚拟化会复用 DOM 节点，
 *    FLIP 计算会得到错误的起始位置。
 */
export const listItem: Variants = {
  hidden: { opacity: 0, y: distance.sm, scale: 0.99 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.smooth },
  exit: {
    opacity: 0,
    x: -distance.sm,
    transition: { duration: duration.fast, ease: ease.accelerate },
  },
};

/** 树节点的子树（任务树）：先展开父级，再依次落下子级 */
export const treeChildren: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: stagger.tight, when: "beforeChildren" },
  },
  exit: {
    opacity: 0,
    transition: { when: "afterChildren", staggerChildren: stagger.tight * 0.5 },
  },
};

/** 网格卡片（稀疏布局，交错更大） */
export const gridItem: Variants = {
  hidden: { opacity: 0, y: distance.md, scale: scaleFrom.card },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.smooth },
  exit: {
    opacity: 0,
    scale: scaleFrom.subtle,
    transition: { duration: duration.fast },
  },
};
