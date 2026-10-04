/**
 * 外观状态（主题 / 质感强度 / 动效强度）
 *
 * 为什么用 Zustand + persist 而不是 React Context：
 *   这三个值会被**大量低频组件**读取（每一个动画、每一个卡片都可能用到），
 *   用 Context 会导致 Provider 内部任何变化都重渲染整棵子树。
 *   Zustand 的选择器订阅让"只有真正用到的组件"重渲染。
 *
 * 为什么持久化到 localStorage 而不是 Dexie：
 *   见 shared/config/appearance.ts 顶部说明 —— 首屏防闪烁需要同步读取。
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  APPEARANCE_DEFAULTS,
  type AppearanceSettings,
  type MotionStrength,
  type TextureStrength,
  type ThemeMode,
} from "@/cadence/shared/config/appearance";
import { STORAGE_KEYS } from "@/cadence/shared/config/storage-keys";
import { readState, writeState } from "@/lib/theme";

interface AppearanceState extends AppearanceSettings {
  setTheme: (theme: ThemeMode) => void;
  setTexture: (texture: TextureStrength) => void;
  setMotion: (motion: MotionStrength) => void;
  reset: () => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...APPEARANCE_DEFAULTS,
      setTheme: (theme) => {
        writeState({ ...readState(), mode: theme });
        set({ theme });
      },
      setTexture: (texture) => set({ texture }),
      setMotion: (motion) => set({ motion }),
      reset: () => set({ ...APPEARANCE_DEFAULTS }),
    }),
    {
      name: STORAGE_KEYS.appearance,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 只持久化设置本身，不写入函数
      partialize: (state) => ({
        theme: state.theme,
        texture: state.texture,
        motion: state.motion,
      }),
    },
  ),
);

/* ── 细粒度选择器 ──
 * 组件永远用这些，而不是解构整个 store。
 * 解构整个 store 会导致任意字段变化时全部重渲染。 */

export const useThemeMode = (): ThemeMode => useAppearanceStore((s) => s.theme);
export const useTextureStrength = (): TextureStrength =>
  useAppearanceStore((s) => s.texture);
export const useMotionStrength = (): MotionStrength =>
  useAppearanceStore((s) => s.motion);
