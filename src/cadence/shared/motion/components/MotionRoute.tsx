/**
 * 页面转场（L3 模式层）
 * ---------------------------------------------------------------------------
 * 刻意不与路由库耦合：只接收 routeKey 与 direction，由 app 层计算。
 * 这样 shared 层保持"不认识业务路由"，也便于在 /motion-lab 里单独演示。
 *
 * `mode="wait"`：旧页面完全退出后新页面才进入。
 * 两个全屏内容重叠会导致视觉混乱，因此页面转场不能用 popLayout。
 */

import { AnimatePresence, m } from "motion/react";
import type { ReactNode } from "react";

import { useResolvedVariants } from "../hooks";
import { pageBack, pageForward, pageLateral } from "../variants/surfaces";

export type TransitionDirection = "forward" | "back" | "lateral";

const VARIANTS = {
  forward: pageForward,
  back: pageBack,
  lateral: pageLateral,
} as const;

interface MotionRouteProps {
  /** 路由标识（通常是 pathname）—— 变化即触发转场 */
  routeKey: string;
  direction?: TransitionDirection;
  className?: string;
  children: ReactNode;
}

export function MotionRoute({
  routeKey,
  direction = "lateral",
  className,
  children,
}: MotionRouteProps) {
  const variants = useResolvedVariants(VARIANTS[direction]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div
        key={routeKey}
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={className}
      >
        {children}
      </m.div>
    </AnimatePresence>
  );
}
