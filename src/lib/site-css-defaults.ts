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
