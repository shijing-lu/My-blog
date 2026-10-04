/**
 * 外观设置的领域常量
 *
 * 为什么这三个开关用 localStorage 而不是 Dexie：
 *   首屏必须在样式表加载前就把主题写到 <html> 上，否则用户会看到一次主题跳动。
 *   Dexie 是异步的，赶不上这个时机。这三个值体积极小、结构固定，localStorage 是正确选择。
 *   业务数据（计划 / 执行 / 复盘 / 待办）一律走 Dexie。
 */

/** 主题模式 */
export type ThemeMode = "light" | "dark" | "system";

/** 质感强度：控制纸张纹理与水彩晕染的显示（05 号文档 §3.1） */
export type TextureStrength = "full" | "subtle" | "off";

/** 动效强度：控制所有动画的节奏（04 号文档 §3.6） */
export type MotionStrength = "full" | "subtle" | "off";

export interface AppearanceSettings {
  theme: ThemeMode;
  texture: TextureStrength;
  motion: MotionStrength;
}

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  theme: "system",
  texture: "full",
  motion: "full",
};

/** 动效强度 → 时长乘数。off 直接置 0，而不是"不渲染"（红线 R5） */
export const MOTION_SCALE: Record<MotionStrength, number> = {
  full: 1,
  subtle: 0.6,
  off: 0,
};

export const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  label: string;
  hint: string;
}> = [
  { value: "light", label: "纸面", hint: "浅色 · 暖调纸感" },
  { value: "dark", label: "墨夜", hint: "深色 · 粗布质感" },
  { value: "system", label: "跟随系统", hint: "随系统外观自动切换" },
];

export const TEXTURE_OPTIONS: ReadonlyArray<{
  value: TextureStrength;
  label: string;
  hint: string;
}> = [
  { value: "full", label: "完整", hint: "纸张纹理 + 水彩晕染全开" },
  { value: "subtle", label: "简约", hint: "仅卡片保留纹理，去掉大面积晕染" },
  { value: "off", label: "关闭", hint: "完全不加载纹理资源" },
];

export const MOTION_OPTIONS: ReadonlyArray<{
  value: MotionStrength;
  label: string;
  hint: string;
}> = [
  { value: "full", label: "完整", hint: "所有手作动效" },
  { value: "subtle", label: "简约", hint: "时长 ×0.6，弹簧更快更少回弹" },
  { value: "off", label: "关闭", hint: "瞬时时切换，功能不受影响" },
];

/** 把设置归一化成实际生效的主题（system 需要解析为 light / dark） */
export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}
