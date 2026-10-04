/**
 * 动画 Provider
 * ---------------------------------------------------------------------------
 * 1. `LazyMotion + domMax` 按需加载动画运行时
 *
 *    ⚠️ 必须用 domMax，不能用 domAnimation —— 这是 M1 实测踩到的坑：
 *    domAnimation 只包含动画/变体/退出动画，**不包含 drag 与 layout（FLIP）**，
 *    而且传了 `drag` / `layout` 会被**静默忽略、没有任何警告**。
 *    本产品的 XY 看板拖拽是 P0 需求，列表让位与共享元素迁移依赖 layout，
 *    因此必须用 domMax。体积代价见 .size-limit.json 的实测记录。
 *
 *    `strict` 模式下禁止使用 `motion.*` 组件，只能用 `m.*`，
 *    避免某个组件不小心把完整运行时打进包（红线 R8，ESLint 也会拦）。
 *
 * 2. `MotionConfig reducedMotion` 做全局无障碍降级。
 *    动效强度设为 off 时，等价于对所有 Motion 动画强制 reducedMotion="always"。
 */

import { LazyMotion, MotionConfig, domMax } from "motion/react";
import type { ReactNode } from "react";

import { useMotionStrength } from "@/cadence/shared/store/appearance-store";

export function MotionProvider({ children }: { children: ReactNode }) {
  const strength = useMotionStrength();

  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion={strength === "off" ? "always" : "user"}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
