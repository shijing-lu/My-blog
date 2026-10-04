/**
 * 路由级组件的懒加载入口
 *
 * 独立成文件的原因：`routes.ts` 只做"定义路由树"这一件事，
 * 不导出任何组件 —— 否则 react-refresh 无法工作（一个文件混合导出
 * 组件与常量会破坏 Fast Refresh 的边界判定）。
 *
 * 每个页面独立成 chunk，对应性能预算：
 * 首屏 JS < 200KB、单路由 chunk < 120KB（NFR-PERF-05）。
 *
 * 这里刻意不抽 `lazyNamed(loader, name)` 这类泛型工具：
 * 在 `noUncheckedIndexedAccess` 下 `T[keyof T]` 会带上 undefined，
 * 需要一个接一个的类型断言才能压下去。逐条写反而更短、更精确 ——
 * 类型由模块本身推导，改名时也会正确报错。
 */

import { lazy } from "react";

export const DashboardPage = lazy(() =>
  import("@/cadence/pages/dashboard").then((m) => ({
    default: m.DashboardPage,
  })),
);

export const PlansPage = lazy(() =>
  import("@/cadence/pages/plans").then((m) => ({ default: m.PlansPage })),
);

export const ExecutePage = lazy(() =>
  import("@/cadence/pages/execute").then((m) => ({ default: m.ExecutePage })),
);

export const ReviewPage = lazy(() =>
  import("@/cadence/pages/review").then((m) => ({ default: m.ReviewPage })),
);

export const SchedulePage = lazy(() =>
  import("@/cadence/pages/schedule").then((m) => ({ default: m.SchedulePage })),
);

export const TodosPage = lazy(() =>
  import("@/cadence/pages/todos").then((m) => ({ default: m.TodosPage })),
);

export const SettingsPage = lazy(() =>
  import("@/cadence/pages/settings").then((m) => ({ default: m.SettingsPage })),
);

/**
 * 动效实验室
 * 刻意不做成"仅 DEV 可用"：生产环境也保留，因为它同时是**性能验收工具**
 * ——验收要跑的就是构建产物（见 playwright.config.ts），而不是 dev server。
 * 它独立成 chunk 且不在首屏加载，对普通用户不可见也不产生开销。
 */
export const MotionLabPage = lazy(() =>
  import("@/cadence/pages/motion-lab").then((m) => ({
    default: m.MotionLabPage,
  })),
);

export const NotFoundPage = lazy(() =>
  import("@/cadence/pages/not-found").then((m) => ({
    default: m.NotFoundPage,
  })),
);

export const StatsPage = lazy(() =>
  import("@/cadence/pages/stats").then((m) => ({ default: m.StatsPage })),
);
