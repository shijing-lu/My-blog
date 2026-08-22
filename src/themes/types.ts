/**
 * 主题系统类型
 *
 * 每个主题 = 一个导出 `ThemeDefinition` 的编译期 TS 模块。
 * 主题只提供「设计令牌」（CSS 变量）与字体选择，由注册表 `buildThemeCss`
 * 渲染成 `html[data-theme='id']` / `html[data-theme='id'].dark` 的全局 CSS。
 */

/** 一套主题的设计令牌（亮/暗各一份） */
export interface ThemeTokens {
  /** 页面背景 */
  background: string;
  /** 前景色 */
  foreground: string;
  /** 卡片背景 */
  card: string;
  /** 卡片前景 */
  cardForeground: string;
  /** 弹层背景 */
  popover: string;
  /** 弹层前景 */
  popoverForeground: string;
  /** 主色调 */
  primary: string;
  /** 主色前景 */
  primaryForeground: string;
  /** 次级色 */
  secondary: string;
  /** 次级前景 */
  secondaryForeground: string;
  /** 弱化色 */
  muted: string;
  /** 弱化前景 */
  mutedForeground: string;
  /** 强调色 */
  accent: string;
  /** 强调前景 */
  accentForeground: string;
  /** 危险色 */
  destructive: string;
  /** 边框 */
  border: string;
  /** 输入框边框 */
  input: string;
  /** 焦点环 */
  ring: string;
  /** 正文字体族 */
  fontSans: string;
  /** 标题衬线体族 */
  fontDisplay: string;
  /** 像素/标签字体族 */
  fontPixel: string;
  /** 圆角 */
  radius: string;
  /** 是否需要霓虹光晕（暗色） */
  glow?: boolean;
}

/** 主题定义 */
export interface ThemeDefinition {
  /** 主题 id（唯一，用作 html[data-theme]） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 排序（升序） */
  order?: number;
  /** 是否为默认主题（默认 = 不设置 data-theme，回落到 :root） */
  isDefault?: boolean;
  /** 亮色令牌 */
  light: ThemeTokens;
  /** 暗色令牌 */
  dark: ThemeTokens;
  /** 设置面板预览色板（背景 / 主色 / 强调色） */
  preview: [string, string, string];
}
