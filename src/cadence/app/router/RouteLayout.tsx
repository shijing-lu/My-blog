/**
 * 路由级布局组件
 *
 * 与 routes.ts 分开：本文件只导出组件，routes.ts 只导出路由树。
 * 混在一起会破坏 Fast Refresh 的边界判定。
 *
 * 布局组件是 app 层与 widget 层的胶水：
 * 它向上读路由状态（决定转场方向），向下把结果交给 AppShell。
 */

import { Outlet } from "@tanstack/react-router";
import { Suspense } from "react";

import { HandRule } from "@/cadence/shared/motion";
import { AppShell } from "@/cadence/widgets/app-shell";
import { AssistantPanel } from "@/cadence/widgets/assistant";

import { NotFoundPage } from "./lazy-pages";
import { useRouteTransition } from "./use-route-transition";

/** 懒加载兜底：铅笔打底稿质感的骨架屏（不是跳动的方块） */
export function RouteFallback() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载中</span>
      <div className="surface-card h-14 opacity-55" />
      <HandRule shape="gentle" />
      <div className="surface-card h-40 opacity-40" />
      <div className="surface-card h-28 opacity-30" />
    </div>
  );
}

/** 根布局：应用外壳 + 页面转场 + 懒加载边界 */
export function RootLayout() {
  const { routeKey, direction } = useRouteTransition();

  return (
    <AppShell routeKey={routeKey} direction={direction}>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
      {/* 助手挂在 app 层（而非 AppShell 内）：它跨页面常驻，且 app 允许组合任意 widgets */}
      <AssistantPanel />
    </AppShell>
  );
}

/** 未知路由 */
export function RouteNotFound() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <NotFoundPage />
    </Suspense>
  );
}
