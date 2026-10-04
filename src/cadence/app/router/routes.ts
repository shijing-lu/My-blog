/**
 * 路由表（代码式路由）
 *
 * 为什么不用文件式路由：
 *   本项目的目录结构按 FSD 分层（pages / widgets / features …），
 *   路由是"应用装配"的职责，属于 app 层。
 *   文件式路由会把 pages 目录变成路由定义源，与分层边界冲突，
 *   还会引入一次代码生成步骤。代码式路由在这里更清晰、依赖更少。
 *
 * 本文件刻意不导出任何组件（组件在 RouteLayout.tsx / lazy-pages.ts），
 * 保证 react-refresh 的 Fast Refresh 边界成立。
 */

import { createRootRoute, createRoute } from "@tanstack/react-router";

import {
  DashboardPage,
  ExecutePage,
  MotionLabPage,
  PlansPage,
  ReviewPage,
  SchedulePage,
  SettingsPage,
  TodosPage,
  StatsPage,
} from "./lazy-pages";
import { RootLayout, RouteNotFound } from "./RouteLayout";

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: RouteNotFound,
});

/**
 * 一级路由
 * 顺序与侧边栏导航一致：先看今天 → 制定 → 执行 → 反思 → 收集 → 设置
 */
const routes = [
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: DashboardPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/plans",
    component: PlansPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/schedule",
    component: SchedulePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/execute",
    component: ExecutePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/review",
    component: ReviewPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/todos",
    component: TodosPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    component: StatsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsPage,
  }),
  // 动效实验室：不进主导航（面向开发者），但保留可访问路径与独立分包
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/motion-lab",
    component: MotionLabPage,
  }),
];

export const routeTree = rootRoute.addChildren(routes);
