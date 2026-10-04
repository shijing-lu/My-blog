/**
 * 响应式断点 Hook
 *
 * 用于"桌面用侧边栏 / 移动用底部 Tab"这类布局切换。
 * 注意：布局结构的变化**不能**只靠 CSS 媒体查询完成（DOM 结构不同），
 * 因此必须有 JS 侧的判断，否则会渲染出两套导航。
 */

import { useEffect, useState } from "react";

export const BREAKPOINTS = {
  /** 低于此宽度视为移动端布局 */
  mobile: 768,
} as const;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** 是否为移动端布局 */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.mobile - 1}px)`);
}
