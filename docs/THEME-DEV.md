# 主题插件开发手册（Theme Plugin Development）

本手册面向**为 My Blog 开发/自定义主题插件**的开发者。主题是「设计令牌（CSS 变量）+ 字体选择」的编译期 TS 模块，插入注册表即可全局生效，支持**替换与扩展**。

---

## 1. 概念

- **主题（Theme）** = 一套 CSS 设计令牌，含亮/暗两套。通过 `html[data-theme='id']` 覆盖全局默认令牌（`:root` / `.dark`）。
- **标识**：`data-theme` 属性值 = 主题 `id`；`id=''`（不设置）表示使用默认主题（回落 `:root`）。
- **令牌驱动**：颜色、字体、圆角全部走 CSS 变量；Tailwind 工具类（`bg-background`、`font-display`、`rounded-lg` 等）读取这些变量，因此换主题即全站换肤。
- **外观模式**：亮 / 暗 / 跟随系统，由 `data-mode` + `.dark` 类控制。

## 2. 目录结构

```
src/themes/
├── types.ts             # ThemeTokens / ThemeDefinition 类型（勿改）
├── fonts.ts             # 预置字体族常量（可复用）
├── index.ts             # 主题注册表：import 并加入 themes 数组
├── _template/index.ts   # ★ 示例模板（可直接复制）
├── claude-pixel/        # 内置：默认
├── terminal/            # 内置：暗黑终端
├── cream-minimal/       # 内置：极简奶油
└── graphite/            # 内置：石墨蓝
```

## 3. 新增一个主题（三步）

### 步骤 1：复制模板
复制 `src/themes/_template/` 为 `src/themes/my-theme/`。

### 步骤 2：改 `index.ts`
```ts
// src/themes/my-theme/index.ts
import type { ThemeDefinition } from '../types';
import { FONT_DISPLAY, FONT_SANS } from '../fonts';

const theme: ThemeDefinition = {
  id: 'my-theme',          // 唯一；用作 html[data-theme='my-theme']
  name: '我的主题',
  description: '一句话描述',
  order: 10,               // 列表排序（升序）
  light: { /* 亮色令牌 */ },
  dark: { /* 暗色令牌 */ },
  preview: ['#ffffff', '#d97757', '#6b8f71'], // 设置面板色板：背景/主色/强调
};
export default theme;
```
> `id` 不得与现有主题重复；若设为默认，请加 `isDefault: true`（并保持只有一个是默认）。

### 步骤 3：注册
在 `src/themes/index.ts` 中：
```ts
import myTheme from './my-theme';
export const themes = [/* 现有 */, myTheme].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
```
> 注册即生效：设置面板会自动列出、`buildThemeCss()` 自动生成其 CSS，无需改其它文件。

## 4. 令牌表（ThemeTokens）

| 字段 | CSS 变量 | 说明 |
| --- | --- | --- |
| `background` | `--background` | 页面背景 |
| `foreground` | `--foreground` | 前景文字 |
| `card` / `cardForeground` | `--card` / `--card-foreground` | 卡片背景/文字 |
| `popover` / `popoverForeground` | `--popover` / `--popover-foreground` | 弹层背景/文字 |
| `primary` / `primaryForeground` | `--primary` / `--primary-foreground` | 主色/主色文字 |
| `secondary` / `secondaryForeground` | `--secondary` / `--secondary-foreground` | 次级色/文字 |
| `muted` / `mutedForeground` | `--muted` / `--muted-foreground` | 弱化色/次要文字 |
| `accent` / `accentForeground` | `--accent` / `--accent-foreground` | 强调色/文字 |
| `destructive` | `--destructive` | 危险/删除 |
| `border` | `--border` | 边框 |
| `input` | `--input` | 输入框边框 |
| `ring` | `--ring` | 焦点环 |
| `fontSans` | `--font-sans-family` | 正文字体族 |
| `fontDisplay` | `--font-display-family` | 标题衬线体族 |
| `fontPixel` | `--font-pixel-family` | 像素/标签体族 |
| `radius` | `--radius` | 圆角（如 `0.75rem`） |
| `glow`（可选） | `--theme-glow` | 是否启用暗色霓虹光晕 |

**字体族常用取值**（`src/themes/fonts.ts`）：`FONT_SANS`（系统栈）、`FONT_DISPLAY`（Lora 衬线）、`FONT_PIXEL`（Silkscreen 像素）、`FONT_MONO`（等宽）。
- 想要「无像素修饰」：`fontPixel: FONT_SANS`；
- 想要「科技等宽标签」：`fontPixel: FONT_MONO`。

**如需新字体**：用 `@fontsource/<字体>` 安装并在 `src/styles/global.css` 顶部 `@import`，再在主题的 `fontDisplay` 里引用该字体族（中文标题会自动回退系统宋体）。

## 5. 关键规则

- **颜色值**：任意合法 CSS 颜色（hex / oklch / rgb）。建议明暗成对提供。
- **覆盖优先级**：主题通过 `html[data-theme='id']`（特异性高于 `:root`）覆盖默认——无需担心与全局默认冲突。
- **不要改** `types.ts`、`index.ts` 的生成逻辑、`theme.ts` 运行时（除非你要扩展能力）。
- **新增即替换**：直接修改某内置主题的 `id`/令牌即可覆盖；也可删除内置主题，从 `themes` 数组移除即可。

## 6. 示例：做一个「青柠」主题

```ts
const theme: ThemeDefinition = {
  id: 'lime',
  name: '青柠',
  description: '清爽青绿 + 暖白',
  order: 12,
  light: {
    background: '#f7faf4', foreground: '#18201a',
    card: '#ffffff', cardForeground: '#18201a',
    popover: '#ffffff', popoverForeground: '#18201a',
    primary: '#4f8f5b', primaryForeground: '#ffffff',
    secondary: '#e7f0e6', secondaryForeground: '#18201a',
    muted: '#e7f0e6', mutedForeground: '#6a736c',
    accent: '#e7f0e6', accentForeground: '#18201a',
    destructive: '#c0362c', border: '#dbe6d8', input: '#dbe6d8', ring: '#4f8f5b',
    fontSans: FONT_SANS, fontDisplay: FONT_DISPLAY, fontPixel: FONT_SANS,
    radius: '0.9rem',
  },
  dark: { /* 对应暗色 */ },
  preview: ['#f7faf4', '#4f8f5b', '#9cc9a4'],
};
```

## 7. 运行时导入自定义主题（无需改代码）

不想动代码？设置面板（右上角调色盘）提供了 **导入 JSON / 下载模板** 入口：

1. 点「**下载模板**」得到 `my-blog-theme-template.json`；
2. 编辑 JSON（改 id / name / 颜色令牌）；
3. 点「**导入 JSON**」选择文件 → 校验通过即生效、并出现在「自定义主题」列表（可随时删除）。

**JSON 格式**（令牌字段与第 4 节一致）：

```json
{
  "id": "my-theme",
  "name": "我的主题",
  "description": "一句话描述",
  "light": {
    "background": "#ffffff",
    "foreground": "#141413",
    "card": "#ffffff",
    "primary": "#d97757",
    "border": "#e3ddd1"
  },
  "dark": {
    "background": "#171514",
    "foreground": "#ede7dc",
    "card": "#1f1b18",
    "primary": "#e08b6e",
    "border": "#2f291f"
  },
  "preview": ["#ffffff", "#d97757", "#e08b6e"]
}
```

**必需令牌**：`light`/`dark` 至少含 `background`、`foreground`、`card`、`primary`、`border`；
其余（`secondary`、`muted`、`accent`、`ring`、`fontSans`、`fontDisplay`、`fontPixel`、`radius` 等）缺省时自动兜底。
`id` 只能包含小写字母/数字/连字符，且不得与内置主题冲突。

> 导入的主题持久化在 localStorage，仅当前浏览器生效；要让所有访客看到，请按第 3 节作为代码插件内置。

## 8. 常见问题
- **改了主题没变化**：确认 `id` 已注册进 `themes` 数组，且没有其它主题 `isDefault` 冲突；刷新或清 localStorage 的 `my-blog-theme` 后再试。
- **像素字没生效**：`fontPixel` 需引用已加载字体（Silkscreen）；无像素主题设 `FONT_SANS` 即可去掉像素感。
- **想让它成为默认**：把该主题 `isDefault: true` 并把默认主题的 `isDefault` 去掉（保持唯一）。
