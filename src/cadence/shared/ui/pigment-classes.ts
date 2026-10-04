/**
 * 颜料语义 → Tailwind 类名映射
 *
 * 为什么需要这个映射（而不是拼字符串）：
 *   Tailwind 在构建期静态扫描源码中的类名。`text-${pigment}-deep` 这种
 *   运行时拼接不会被识别，样式在构建后就会丢失。
 *   因此必须写成完整的字面量，让扫描器看得见。
 */

import type { PigmentKey } from "@/cadence/shared/config/pigment";

export interface PigmentClasses {
  /** 图形 / 色点背景 */
  dot: string;
  /** ≥ 4.5:1 的文字色 */
  text: string;
  /** 浅色填充背景 */
  softBg: string;
  /** 强调边框 */
  border: string;
}

export const PIGMENT_CLASSES: Record<PigmentKey, PigmentClasses> = {
  plan: {
    dot: "bg-amber-base",
    text: "text-amber-deep",
    softBg: "bg-amber-soft",
    border: "border-amber-base",
  },
  session: {
    dot: "bg-clay-base",
    text: "text-clay-deep",
    softBg: "bg-clay-soft",
    border: "border-clay-base",
  },
  done: {
    dot: "bg-forest-base",
    text: "text-forest-deep",
    softBg: "bg-forest-soft",
    border: "border-forest-base",
  },
  todo: {
    dot: "bg-craft-base",
    text: "text-craft-deep",
    softBg: "bg-craft-soft",
    border: "border-craft-base",
  },
  review: {
    dot: "bg-fabric-base",
    text: "text-fabric-deep",
    softBg: "bg-fabric-soft",
    border: "border-fabric-base",
  },
  archive: {
    dot: "bg-ochre-base",
    text: "text-ochre-deep",
    softBg: "bg-ochre-soft",
    border: "border-ochre-base",
  },
};

export function pigmentClasses(key: PigmentKey): PigmentClasses {
  return PIGMENT_CLASSES[key];
}
