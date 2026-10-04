/**
 * 路由实例
 *
 * 历史策略按运行环境选择（NFR-PORT-03）：
 *   浏览器      → browser history（地址栏干净、可分享）
 *   Tauri / Capacitor 原生壳 → hash history
 *     原因：原生壳用自定义协议或 file 协议加载页面，browser history
 *     在刷新与深链接时容易 404。hash 路由没有这个问题。
 *
 * 平台检测集中在这一处，待 M8 引入 shared/platform 适配层后会迁移过去。
 */

import {
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router";

import { routeTree } from "./routes";

function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "Capacitor" in window;
}

const history = isNativeShell() ? createHashHistory() : createBrowserHistory();

export const router = createRouter({
  basepath: "/schedule",
  routeTree,
  history,
  // 悬停导航项即预取目标 chunk —— 让切页感觉更快（技术架构文档 §7.2）
  defaultPreload: "intent",
  defaultPreloadDelay: 60,
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultStructuralSharing: true,
});

/** 让全项目的 Link / navigate 获得端到端类型安全 */
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
