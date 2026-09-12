/**
 * 全站文字默认样式（内置「豪放 · 活泼」风格包）
 *
 * - 由 BaseLayout 注入 `@layer site-text { … }`（层级顺序见 global.css 头部声明：
 *   theme → base → components → utilities → site-text）：
 *     · 压过组件层默认与元素工具类（如 font-semibold）→ 风格真正"应用于整个系统"；
 *     · 被「全站样式自定义」（unlayered 用户 CSS）整体覆盖 → 管理员随时接管；
 *     · 被 Markdown 样式（scopeMdCss 后 unlayered）覆盖 → 不与该功能抢话语权。
 * - 只用设计令牌（--color-primary / --color-foreground / --color-muted-foreground），
 *   明暗双主题与主题换色自动跟随。
 * - 覆盖范围（对应设置页说明）：标题（页面/分区/弹窗/prose）、正文段落与列表、
 *   正文语境链接、按钮（含图标钮）、主导航/页脚导航链接、表单标签与控件字体、
 *   占位符、像素徽章字距、文字选区、强调加粗、断行策略。
 * - 刻意不做的（贴合语境、保层级）：不统一改写提示类弱化文字的颜色（.text-muted-foreground
 *   的层级语义靠它表达）；不改像素/显示字体的归属（组件层已按语境指定）；
 *   不给按钮/导航形态的链接加正文下划线。
 */

export const DEFAULT_SITE_TEXT_CSS = `/* ============================================================
 * 内置默认：豪放 · 活泼（全站文字风格包）
 * 本包在 site-text 层生效：强于组件默认，弱于元素工具类与下方自定义 CSS。
 * 修改后点「保存并应用」全站生效；清空 = 回到本默认。
 * ============================================================ */

/* 文字选中：主色高亮，全站所有文本（含标题/正文/代码） */
::selection {
  background: color-mix(in srgb, var(--color-primary) 26%, transparent);
}

/* ── 标题 ─────────────────────────────────────────────────────
   页面标题、分区标题、弹窗标题、prose 标题：整体加重、收紧字距；
   一二级标题叠加主色马克笔下划线（豪放记号感）。
   flex 容器型标题（筛选区标题、归档年份）不传播装饰，不受影响。 */
:where(h1, h2, h3, h4, h5, h6) {
  font-weight: 800;
  letter-spacing: -0.01em;
}
:where(h1, h2) {
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--color-primary) 36%, transparent);
  text-decoration-thickness: 0.14em;
  text-underline-offset: 0.18em;
}
:where(h1) {
  text-decoration-thickness: 0.18em;
}

/* ── 正文 ─────────────────────────────────────────────────────
   段落/列表项启用更舒展的断行策略（渐进增强，旧浏览器自动忽略） */
:where(p, li, dd) {
  text-wrap: pretty;
}

/* ── 强调 ─────────────────────────────────────────────────────
   加粗更重；颜色不动（语境色由所在组件决定） */
:where(strong, b) {
  font-weight: 800;
}

/* ── 链接 ─────────────────────────────────────────────────────
   正文语境的链接（prose / 段落 / 列表 / 表格内）一律鲜明可辨：
   主色混色 + 粗下划线，悬停转纯主色。
   导航、按钮、卡片等"按钮形态"的链接刻意不在范围内。 */
:where(.prose a, main :is(p, li, dd, td, th) a) {
  color: color-mix(in srgb, var(--color-primary) 78%, var(--color-foreground));
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--color-primary) 42%, transparent);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  transition: color 0.2s ease, text-decoration-color 0.2s ease;
}
:where(.prose a, main :is(p, li, dd, td, th) a):hover {
  color: var(--color-primary);
  text-decoration-color: var(--color-primary);
}

/* ── 按钮 ─────────────────────────────────────────────────────
   加重 + 微字距；恢复手型光标（预检样式把按钮游标改成了 default） */
:where(button, [role='button']) {
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.02em;
}

/* ── 导航 ─────────────────────────────────────────────────────
   主导航 / 页脚导航链接：加重 + 放宽字距（不放正文下划线，保导航利落） */
:where(header nav a, footer nav a) {
  font-weight: 600;
  letter-spacing: 0.03em;
}

/* ── 表单 ─────────────────────────────────────────────────────
   标签加重；控件继承正文字体（浏览器默认不等宽/不同族的问题一并修正）；
   占位符在弱化色上再退一档，输入内容永远比提示更醒目 */
:where(label, legend) {
  font-weight: 600;
}
:where(input, textarea, select) {
  font-family: inherit;
  letter-spacing: inherit;
}
:where(input::placeholder, textarea::placeholder) {
  color: color-mix(in srgb, var(--color-muted-foreground) 75%, transparent);
}

/* ── 徽章像素字 ───────────────────────────────────────────────
   分类章 / 筛选区标题 / 状态徽章：字距放宽一档，强化"标签感" */
:where(.pixel-chip) {
  letter-spacing: 0.14em;
}
`;

/** 内置预设风格 */
export interface SiteTextPreset {
  id: string;
  name: string;
  tagline: string;
  css: string;
}

/**
 * 内置预设风格库（设置页一键填入，可改后保存为自定义）。
 * 每套与默认包同选择器骨架（覆盖面一致），并显式重置与默认包不同的属性
 * （默认包始终注入 site-text 层，预设保存为 unlayered 自定义后逐条覆盖之）。
 */
export const SITE_TEXT_PRESETS: SiteTextPreset[] = [
  {
    id: 'bold',
    name: '豪放 · 活泼',
    tagline: '主色马克笔下划线 + 重字重（内置默认）',
    css: DEFAULT_SITE_TEXT_CSS,
  },
  {
    id: 'serene',
    name: '雅致 · 宋韵',
    tagline: '衬线标题、宽字距、去装饰——文人气',
    css: `/* ============================================================
 * 雅致 · 宋韵 —— 衬线标题 / 宽字距 / 弱装饰的文人书卷气
 * ============================================================ */

::selection {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}

/* 标题换衬线（Lora + 宋体族），字重收敛、字距放宽、去装饰 */
:where(h1, h2, h3, h4, h5, h6) {
  font-family: var(--font-display-family);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-decoration: none;
}

:where(p, li, dd) {
  text-wrap: pretty;
  letter-spacing: 0.015em;
}

:where(strong, b) {
  font-weight: 700;
}

/* 正文链接：不做色块与粗下划线，改为细线随行（悬停显主色） */
:where(.prose a, main :is(p, li, dd, td, th) a) {
  color: var(--color-foreground);
  font-weight: 500;
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  transition: color 0.2s ease, border-color 0.2s ease;
}
:where(.prose a, main :is(p, li, dd, td, th) a):hover {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

:where(button, [role='button']) {
  cursor: pointer;
  font-weight: 500;
  letter-spacing: 0.14em;
}

:where(header nav a, footer nav a) {
  font-weight: 500;
  letter-spacing: 0.18em;
}

:where(label, legend) {
  font-weight: 500;
  letter-spacing: 0.06em;
}
:where(input, textarea, select) {
  font-family: inherit;
}
:where(input::placeholder, textarea::placeholder) {
  color: color-mix(in srgb, var(--color-muted-foreground) 70%, transparent);
}

:where(.pixel-chip) {
  letter-spacing: 0.22em;
}
`,
  },
  {
    id: 'print',
    name: '复古 · 印刷',
    tagline: '报刊规则线 + 衬线大写标题，黑白灰一抹主色',
    css: `/* ============================================================
 * 复古 · 印刷 —— 报刊规则线 / 衬线大写标题（拉丁生效）/ 反色选区
 * ============================================================ */

/* 选区反色：铅字印刷感 */
::selection {
  background: color-mix(in srgb, var(--color-foreground) 88%, transparent);
  color: var(--color-background);
}

/* 标题换衬线 + 拉丁大写；一二级标题下压报纸规则线 */
:where(h1, h2, h3, h4, h5, h6) {
  font-family: var(--font-display-family);
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  text-decoration: none;
}
:where(h1, h2) {
  border-bottom: 2px solid color-mix(in srgb, var(--color-foreground) 72%, transparent);
  padding-bottom: 0.2em;
}

:where(p, li, dd) {
  text-wrap: pretty;
}

:where(strong, b) {
  font-weight: 800;
}

/* 正文链接：墨色细下划线，悬停转主色 */
:where(.prose a, main :is(p, li, dd, td, th) a) {
  color: var(--color-foreground);
  font-weight: 500;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
  text-underline-offset: 4px;
  transition: color 0.2s ease, text-decoration-color 0.2s ease;
}
:where(.prose a, main :is(p, li, dd, td, th) a):hover {
  color: var(--color-primary);
  text-decoration-color: var(--color-primary);
}

:where(button, [role='button']) {
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.08em;
}

:where(header nav a, footer nav a) {
  font-weight: 600;
  letter-spacing: 0.1em;
}

:where(label, legend) {
  font-weight: 600;
}
:where(input, textarea, select) {
  font-family: inherit;
}
:where(input::placeholder, textarea::placeholder) {
  color: color-mix(in srgb, var(--color-muted-foreground) 70%, transparent);
}

:where(.pixel-chip) {
  letter-spacing: 0.16em;
}
`,
  },
  {
    id: 'terminal',
    name: '终端 · 极客',
    tagline: '等宽标题、虚线下划线、反色选区，命令行气质',
    css: `/* ============================================================
 * 终端 · 极客 —— 等宽字体标题与链接 / 虚线装饰 / 反色选区
 * ============================================================ */

/* 选区：主色实底反白，像选中了一行命令 */
::selection {
  background: var(--color-primary);
  color: var(--color-background);
}

/* 标题：等宽 + 拉丁大写；一二级标题虚线下划线（终端链接既视感） */
:where(h1, h2, h3, h4, h5, h6) {
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
  text-decoration: none;
}
:where(h1, h2) {
  text-decoration: underline;
  text-decoration-style: dashed;
  text-decoration-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.25em;
}

:where(p, li, dd) {
  text-wrap: pretty;
}

/* 强调：主色混色（终端高亮） */
:where(strong, b) {
  font-weight: 700;
  color: color-mix(in srgb, var(--color-primary) 65%, var(--color-foreground));
}

/* 链接：等宽 + 虚线下划线，悬停转实线 */
:where(.prose a, main :is(p, li, dd, td, th) a) {
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 0.95em;
  font-weight: 600;
  text-decoration: underline;
  text-decoration-style: dashed;
  text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
  text-underline-offset: 3px;
  transition: text-decoration-style 0.15s ease;
}
:where(.prose a, main :is(p, li, dd, td, th) a):hover {
  text-decoration-style: solid;
  text-decoration-color: var(--color-primary);
}

:where(button, [role='button']) {
  cursor: pointer;
  font-family: var(--font-mono);
  font-weight: 600;
  letter-spacing: 0.04em;
}

:where(header nav a, footer nav a) {
  font-family: var(--font-mono);
  font-weight: 600;
  letter-spacing: 0.06em;
}

:where(label, legend) {
  font-weight: 500;
}
:where(input, textarea, select) {
  font-family: var(--font-mono);
}
:where(input::placeholder, textarea::placeholder) {
  color: color-mix(in srgb, var(--color-muted-foreground) 65%, transparent);
}

:where(.pixel-chip) {
  letter-spacing: 0.1em;
}
`,
  },
  {
    id: 'journal',
    name: '手账 · 暖糖',
    tagline: '波浪线 + 荧光笔强调，圆润轻松的手账感',
    css: `/* ============================================================
 * 手账 · 暖糖 —— 波浪线标题 / 荧光笔强调 / 轻松字距
 * ============================================================ */

::selection {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}

/* 标题：重但不严肃，波浪线记号 */
:where(h1, h2, h3, h4, h5, h6) {
  font-weight: 700;
  letter-spacing: 0.03em;
  text-decoration: none;
}
:where(h1, h2) {
  text-decoration: underline;
  text-decoration-style: wavy;
  text-decoration-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.22em;
}

:where(p, li, dd) {
  text-wrap: pretty;
}

/* 强调：荧光笔划过效果 */
:where(strong, b) {
  font-weight: 700;
  background: linear-gradient(transparent 58%, color-mix(in srgb, var(--color-primary) 22%, transparent) 0);
  border-radius: 2px;
  padding: 0 0.1em;
}

/* 链接：细实线随行，悬停变波浪 */
:where(.prose a, main :is(p, li, dd, td, th) a) {
  color: color-mix(in srgb, var(--color-primary) 72%, var(--color-foreground));
  font-weight: 600;
  text-decoration: underline;
  text-decoration-thickness: 1.5px;
  text-decoration-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  text-underline-offset: 3px;
  transition: text-decoration-style 0.15s ease, color 0.2s ease;
}
:where(.prose a, main :is(p, li, dd, td, th) a):hover {
  color: var(--color-primary);
  text-decoration-style: wavy;
  text-decoration-color: var(--color-primary);
}

:where(button, [role='button']) {
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0.06em;
}

:where(header nav a, footer nav a) {
  font-weight: 600;
  letter-spacing: 0.08em;
}

:where(label, legend) {
  font-weight: 600;
  letter-spacing: 0.02em;
}
:where(input, textarea, select) {
  font-family: inherit;
}
:where(input::placeholder, textarea::placeholder) {
  color: color-mix(in srgb, var(--color-muted-foreground) 70%, transparent);
}

:where(.pixel-chip) {
  letter-spacing: 0.18em;
}
`,
  },
];
