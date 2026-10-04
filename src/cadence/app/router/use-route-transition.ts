/**
 * 路由转场方向判定
 *
 * 把"这是前进还是后退"的判定从布局组件里抽出来 ——
 * AppShell（widget）不认识路由，只接收结果。
 *
 * 方向规则：路由深度增加 = 前进，减少 = 后退，相同 = 同级切换。
 * 现在 6 个一级页面互为同级，所以实际走 pageLateral；
 * 等 M3/M5/M6 加入详情页（如 /plans/$planId）后，前进/后退会自动生效。
 */

import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import type { TransitionDirection } from "@/cadence/shared/motion";

/** 一级页面深度为 1，根路径为 0，详情页为 2 */
function routeDepth(pathname: string): number {
  if (pathname === "/") return 0;
  return pathname.split("/").filter(Boolean).length;
}

export function useRouteTransition(): {
  routeKey: string;
  direction: TransitionDirection;
} {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const previousDepth = useRef<number | null>(null);

  const direction = useMemo<TransitionDirection>(() => {
    const depth = routeDepth(pathname);
    const previous = previousDepth.current;
    if (previous === null || depth === previous) return "lateral";
    return depth > previous ? "forward" : "back";
  }, [pathname]);

  useEffect(() => {
    previousDepth.current = routeDepth(pathname);
  }, [pathname]);

  return { routeKey: pathname, direction };
}
