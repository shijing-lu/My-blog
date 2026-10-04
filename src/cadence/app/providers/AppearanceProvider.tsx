/**
 * 外观 Provider
 * ---------------------------------------------------------------------------
 * 职责：把 Zustand 里的外观设置同步到 <html> 的 data-* 属性上。
 *
 * 为什么走 DOM 属性而不是给组件传 props：
 *   主题、质感、动效强度三者都体现在 CSS 变量上。写到 <html> 后，
 *   浏览器自行重算样式，React 树一次都不用重渲染 —— 这是主题切换零开销的关键。
 *
 * index.html 里有一段内联脚本做同样的事（首屏防闪烁）。这里是运行期的持续同步：
 * 用户改设置、系统切换深浅色，都要立刻生效。
 */

import { useEffect, useState, type ReactNode } from "react";

import { MOTION_SCALE, resolveTheme } from "@/cadence/shared/config/appearance";
import { THEME_META_COLOR } from "@/cadence/shared/config/pigment";
import {
  useMotionStrength,
  useTextureStrength,
  useThemeMode,
} from "@/cadence/shared/store/appearance-store";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return prefersDark;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const themeMode = useThemeMode();
  const texture = useTextureStrength();
  const motion = useMotionStrength();
  const prefersDark = usePrefersDark();

  useEffect(() => {
    const root = document.documentElement;
    const resolved = resolveTheme(themeMode, prefersDark);

    root.dataset.theme = resolved;
    root.dataset.texture = texture;
    root.dataset.motion = motion;
    // 供 CSS transition 与内联样式使用（数值形式，便于计算）
    root.style.setProperty("--motion-scale", String(MOTION_SCALE[motion]));

    // 同步浏览器 UI 主题色（移动端地址栏 / 桌面端窗口边框）
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]:not([media])',
    );
    if (meta)
      meta.content =
        resolved === "dark" ? THEME_META_COLOR.dark : THEME_META_COLOR.light;
  }, [themeMode, prefersDark, texture, motion]);

  /* 页面隐藏时暂停持续的装饰动画（04 号文档 §6.3 降级编排）
   * 用属性而不是直接改样式：CSS 侧通过 .pause-when-hidden 统一响应。 */
  useEffect(() => {
    const onVisibility = () => {
      document.documentElement.dataset.pageHidden = String(document.hidden);
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return <>{children}</>;
}
