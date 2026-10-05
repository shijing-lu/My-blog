/**
 * Provider 组合
 *
 * 顺序即依赖顺序：
 *   ErrorBoundary    最外层 —— 任何内层异常都要被兜住
 *   AppearanceProvider 跟随站点主题；只在模块根节点写入 data-texture / data-motion
 *   MotionProvider   依赖动效强度（来自外观状态），因此在 AppearanceProvider 内层
 *
 * M2 会在 MotionProvider 内层加入数据层 Provider，M8 加入 PlatformProvider。
 */

import type { ReactNode } from "react";

import { ErrorBoundary } from "./ErrorBoundary";
import { MotionProvider } from "./MotionProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <MotionProvider>{children}</MotionProvider>
    </ErrorBoundary>
  );
}
