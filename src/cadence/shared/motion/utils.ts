/**
 * 动画系统的解析与降级工具
 * ---------------------------------------------------------------------------
 * 这一层的存在意义：把"动效强度"与"无障碍降级"这两件事集中处理，
 * 业务组件不需要知道当前是 full / subtle / off，也不需要各自写降级判断。
 */

import type { Transition, Variants } from "motion/react";

import {
  MOTION_SCALE,
  type MotionStrength,
} from "@/cadence/shared/config/appearance";
import { stagger } from "./tokens";

type LooseRecord = Record<string, unknown>;

/**
 * 按动效强度解析一个 transition
 *
 * ★ 红线 R5：`off` 档必须返回 `{ duration: 0 }`，而不是"不动画"。
 *   带 AnimatePresence 的元素仍然要正常挂载与卸载，依赖 onAnimationComplete
 *   的逻辑也必须照常触发 —— 只是没有过渡过程。
 */
export function resolveMotion(
  transition: Transition,
  strength: MotionStrength,
): Transition {
  const scale = MOTION_SCALE[strength];
  if (scale === 0) return { duration: 0 };
  if (scale === 1) return transition;

  const t = transition as LooseRecord;

  // 弹簧：降刚度、提阻尼 → 更快更稳，视觉上"更简约"，但仍保留物理感
  if (typeof t.stiffness === "number") {
    return {
      ...transition,
      stiffness: t.stiffness * 1.25,
      damping: typeof t.damping === "number" ? t.damping * 1.1 : t.damping,
    } as Transition;
  }

  // 补间：按时长乘数缩放
  if (typeof t.duration === "number") {
    return { ...transition, duration: t.duration * scale } as Transition;
  }

  return transition;
}

/** 把单个变体目标的所有 transition 压成 duration: 0，保留状态定义本身 */
function collapseTarget(target: LooseRecord): LooseRecord {
  return { ...target, transition: { duration: 0 } };
}

/**
 * 把整套变体降级为"瞬时切换"
 *
 * 保留每个状态的属性定义（opacity / y / scale 等仍然会被应用），
 * 只把 transition 压成 0 —— 这样布局与状态切换仍然正确完成，只是看不见过程。
 * 动态变体（函数形式）会被包装后递归处理。
 */
export function collapseVariants(variants: Variants): Variants {
  const out: LooseRecord = {};

  for (const [name, value] of Object.entries(variants)) {
    if (typeof value === "function") {
      const fn = value as unknown as (
        custom: unknown,
        current: unknown,
      ) => LooseRecord;
      out[name] = (custom: unknown, current: unknown) =>
        collapseTarget(fn(custom, current));
    } else {
      out[name] = collapseTarget(value as LooseRecord);
    }
  }

  return out as Variants;
}

/** 按强度解析整套变体 */
export function resolveVariants(
  variants: Variants,
  strength: MotionStrength,
): Variants {
  if (MOTION_SCALE[strength] === 0) return collapseVariants(variants);
  return variants;
}

/**
 * 计算受上限约束的实际交错间隔
 *
 * 30 项的列表若直接用 0.055 的间隔，总时长会到 1.6s —— 用户会觉得卡顿。
 * 封顶后自动压缩到 stagger.max。
 */
export function staggerInterval(
  count: number,
  base: number = stagger.base,
): number {
  if (count <= 1) return 0;
  return Math.min(base, stagger.max / (count - 1));
}

/** 交错序列的总时长（用于性能验收：页面入场应 ≤ 700ms） */
export function staggerTotal(
  count: number,
  base: number = stagger.base,
): number {
  return count <= 1 ? 0 : staggerInterval(count, base) * (count - 1);
}

/** 把 [0,1] 的进度映射为 stroke-dashoffset（笔触绘制用） */
export function drawOffset(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - clamped;
}

/**
 * 生成全局唯一的共享元素 layoutId
 *
 * 为什么必须走函数而不是手拼字符串（SharedElement.tsx 顶部有完整说明）：
 *   手拼很容易漏掉 kind 前缀，两处不同实体的 id 恰好相同时，
 *   共享元素会"飞"到错误的目标位置，而且这个 bug 只在特定数据下复现。
 */
export function sharedElementId(kind: string, id: string): string {
  return `se-${kind}-${id}`;
}
