/**
 * 外观 Provider
 * ---------------------------------------------------------------------------
 * 站点主题由统一的 theme.ts 管理。日程仅持有模块动效和质感设置，
 * 不写 <html> 的主题、明暗模式或浏览器主题色，避免导航进日程时覆盖站点选择。
 */

import { useEffect, type ReactNode } from "react";

import {
  useAppearanceStore,
  useMotionStrength,
  useTextureStrength,
} from "@/cadence/shared/store/appearance-store";
import { applyCadenceAppearance } from "@/cadence/shared/lib/site-appearance";
import { readState } from "@/lib/theme";

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const texture = useTextureStrength();
  const motion = useMotionStrength();

  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".cadence-root").forEach((root) => {
      applyCadenceAppearance(root, texture, motion);
    });
  }, [texture, motion]);

  useEffect(() => {
    const syncTheme = () => {
      const theme = readState().mode;
      if (useAppearanceStore.getState().theme !== theme) {
        // 不走 setTheme：它代表用户操作，会再次持久化并应用全站主题。
        useAppearanceStore.setState({ theme });
      }
    };
    syncTheme();
    window.addEventListener("byqx:theme-change", syncTheme);
    window.addEventListener("storage", syncTheme);
    return () => {
      window.removeEventListener("byqx:theme-change", syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  /* 页面隐藏时暂停持续的装饰动画（04 号文档 §6.3 降级编排）
   * 用属性而不是直接改样式：CSS 侧通过 .pause-when-hidden 统一响应。 */
  useEffect(() => {
    const onVisibility = () => {
      document.querySelectorAll<HTMLElement>(".cadence-root").forEach((root) => {
        root.dataset.pageHidden = String(document.hidden);
      });
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return <>{children}</>;
}
