/**
 * 外壳 UI 状态（侧边栏折叠）
 *
 * 与 appearance-store 分开：外观三项目前用于 CSS 变量与防闪烁脚本，
 * 折叠状态是纯布局偏好，混进去会让 partialize 与防闪烁脚本都要跟着改。
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { STORAGE_KEYS } from "@/cadence/shared/config/storage-keys";

interface ShellState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: STORAGE_KEYS.shell,
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const useSidebarCollapsed = (): boolean =>
  useShellStore((s) => s.sidebarCollapsed);
