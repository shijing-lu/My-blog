/**
 * 手作专属动画原型（L2 资产层 · craft）
 * 依据：docs/05-视觉风格与手作动效规范.md §4.2
 *
 * 这六个原型是「匠人手账」风格的动效签名。
 * 在通用原型之上加入"手作过程"的表达：笔触、盖印、晕开、摇曳、展开、摆放。
 *
 * ⚠️ 全部为强制约束：
 *   - 旋转幅度上限见 tokens.rotation（红线 C5）
 *   - blur 只能用于过渡，不能持续（红线 C3）
 *   - reduced-motion 降级：仅 drawIn 保留（承载进度信息），其余见各注释
 */

import type { Variants } from "motion/react";

import { distance, duration, ease, spring } from "../tokens";

/**
 * ① drawIn · 笔触自绘
 *
 * 线条从无到有被"画"出来。用于分隔线、进度环、图标、折线的首次绘制。
 *
 * ♿ 无障碍：这是六个原型中**唯一在 prefers-reduced-motion 下保留**的 ——
 *    它是线性、低刺激的动画，且承载"正在加载 / 进度"的信息
 *    （04 号文档 §7.1：装饰性移除，信息性保留）。降级时仅压缩时长到 180ms。
 */
export const drawIn: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: duration.deliberate, ease: ease.decelerate },
      opacity: { duration: duration.instant },
    },
  },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

/**
 * ② stampIn · 盖印
 *
 * 从上方落下并压定，带轻微旋转。用于任务级完成、徽记解锁。
 *
 * 与 checkPop 的分工：checkPop 给高频的普通复选框（要快）；
 * stampIn 给**低频、值得被看见**的完成时刻。
 * ♿ 降级为 fade（移除位移、旋转、缩放过冲）。
 */
export const stampIn: Variants = {
  hidden: { opacity: 0, scale: 1.45, rotate: -6, y: -distance.sm },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    y: 0,
    transition: spring.bouncy,
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: duration.fast, ease: ease.accelerate },
  },
};

/**
 * ③ smudge · 晕开
 *
 * 颜色在纸上扩散。用于标签新增、复风格填色、色块状态变化。
 *
 * ⚠️ 红线 C3：这里的 blur 是**过渡动画**（6px → 0），不是持续动画。
 *    但元素面积必须 ≤ 200×200px，超出时改用 smudgeLite。
 * ♿ 降级为 fade 且**移除 blur** —— 前庭敏感用户对模糊扩散尤其不适。
 */
export const smudge: Variants = {
  hidden: { opacity: 0, scale: 0.55, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: duration.slow, ease: ease.decelerate },
  },
  exit: {
    opacity: 0,
    scale: 0.8,
    filter: "blur(4px)",
    transition: { duration: duration.fast },
  },
};

/** smudge 的无 blur 版本 —— 大面积元素（> 200×200px）必须用这个 */
export const smudgeLite: Variants = {
  hidden: { opacity: 0, scale: 0.7 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: duration.slow, ease: ease.decelerate },
  },
  exit: { opacity: 0, scale: 0.85, transition: { duration: duration.fast } },
};

/**
 * ④ wobble · 摇曳
 *
 * 用于"进行中"状态的指示物（替代通用的呼吸点），像工坊里摇曳的烛火。
 *
 * ⚠️ 硬性约束：
 *   - 仅作用于 ≤ 24×24px 的元素
 *   - 幅度 ≤ 0.6°（超过会引起文字 / 图标边缘的非整数像素模糊，红线 C5）
 *   - 必须加 .pause-when-hidden 类，页面隐藏时暂停（04 号文档 §6.3）
 * ♿ 降级：完全移除，改为静态色点。
 */
export const wobble: Variants = {
  idle: { rotate: 0, scale: 1 },
  active: {
    rotate: [-0.6, 0.6, -0.6],
    scale: [1, 1.06, 1],
    transition: { duration: 3.4, repeat: Infinity, ease: "easeInOut" },
  },
};

/**
 * ⑤ unwrap · 展开
 *
 * 像展开一张卷起的纸。用于任务详情、复盘表单、计划卡片下钻。
 * 是 collapse 的手作版本（多了旋转与过冲）。
 * ♿ 降级为瞬时切换 —— 高度动画最易引发前庭不适（04 号文档 §7.1）。
 */
export const unwrap: Variants = {
  hidden: {
    height: 0,
    opacity: 0,
    rotate: -0.8,
    transformOrigin: "top center",
  },
  visible: {
    height: "auto",
    opacity: 1,
    rotate: 0,
    transition: {
      height: { duration: 0.44, ease: ease.decelerate },
      rotate: { duration: 0.44, ease: ease.overshoot },
      opacity: { duration: duration.fast, delay: 0.05 },
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

/**
 * ⑥ placeOn · 摆上去
 *
 * 元素从下方升起、轻微旋转、落定 —— 最常用的手作入场，替代 rise 做默认卡片入场。
 *
 * ⚠️ 旋转中的文字难以阅读，因此**文字密集的区块必须用 rise 而非 placeOn**。
 *    幅度上限 1.2°（红线 C5）。
 * ♿ 降级为 fade。
 */
export const placeOn: Variants = {
  hidden: { opacity: 0, y: distance.md, rotate: -1.2, scale: 0.97 },
  visible: { opacity: 1, y: 0, rotate: 0, scale: 1, transition: spring.smooth },
  exit: {
    opacity: 0,
    y: -distance.sm,
    rotate: 0.8,
    transition: { duration: duration.fast, ease: ease.accelerate },
  },
};
