/**
 * InlineCode —— 行内代码（`code`）映射组件：悬停右上角一键复制
 *
 * ## 行为
 * - **行内代码**：包一层 `<span class="inline-code" data-code-block>`，右上角注入复制按钮
 *   （`data-copy`）。悬停/键盘聚焦时按钮显形（样式见 global.css）。
 * - **代码块内的 code**（`pre > code`）：原样渲染裸 `<code>`，**不注入按钮** ——
 *   代码块的复制按钮由 `Pre` 统一提供，避免一个代码块出现两个按钮。
 *
 * ## 复用而非重造
 * 复制逻辑完全复用 `src/scripts/copy-button.ts` 的 document 级委托：
 * 点击 `[data-copy]` → `closest('[data-code-block]')` → 取内部 `code` 文本 → 复制 + 成功/失败反馈。
 * 因此行内按钮只需满足该约定（按钮在 `[data-code-block]` 容器内、且是 `code` 的兄弟节点，
 * 按钮自身文本不会被 `codeText()` 取到 —— 它只读容器内的 `code`）。
 *
 * ## ⚠️ 三个刻意的取舍（2026-09-21 对抗审查后确认，勿随意改回）
 * 1. **按钮内不放 SVG/`<use>`，图标由 CSS mask 提供**：行内代码出现频率极高
 *    （实测 31KB 文章 331 处）。逐个内联 SVG 会让 HTML 原始体积 +228KB；
 *    换 sprite（`<use>`）后降到 +69KB，但每处仍多出 6 个标签。
 *    最终改为 CSS `mask-image`（图标在样式表里定义一次）→ 每处只剩
 *    `span` + `button` 两个标签、约 110B，节点与体积双达标。
 *    复制成功态由 `.copied` 类切换 mask（`copy-button.ts` 的 flash 用可选链
 *    查询 `[data-icon]`，无图标元素时静默跳过，故无需改动脚本）。
 *    代码块（Pre）数量少，仍用 BaseLayout 的 sprite SVG，两处视觉一致。
 * 2. **`tabIndex={-1}`**：不移出 DOM 但移出 Tab 序列。否则每个行内代码都会成为一个
 *    键盘停靠点（同一篇 331 处 → 要按 331 次 Tab 才能越过正文），而无障碍的等价路径
 *    是浏览器原生的「选中文本 → Ctrl/Cmd+C」。鼠标用户与辅助技术仍可正常触发。
 * 3. **按钮是 `code` 的兄弟节点**（不在 `code` 内）：`codeText()` 只读容器内 `code` 的文本，
 *    这样按钮自身的图标/文案不会混入剪贴板内容。
 *
 * ## ⚠️ 阅读模式 / 编辑模式的边界
 * 本组件只在 **MDX 渲染产物**中出现（文章页、文档页、动态卡片）。编辑态是 CodeMirror
 * （`cm-live-preview` / `cm-wysiwyg` 的装饰器实现），不经过 MDX 管线，故
 * **编辑模式下天然不显示复制按钮**，无需额外判断。
 */
import type { ReactElement, ReactNode } from 'react';
import { useInsideCodeBlock } from './CodeBlockContext';

export default function InlineCode({
  children,
  className,
  ...props
}: {
  children?: ReactNode;
  className?: string;
} & Record<string, unknown>): ReactElement {
  const insideCodeBlock = useInsideCodeBlock();

  // 代码块内的 code：交给 Pre 的按钮，自己不渲染任何包装
  if (insideCodeBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <span className="inline-code" data-code-block>
      <code className={className} {...props}>
        {children}
      </code>
      {/* 图标由 CSS mask 提供（见 global.css 的 .inline-code .copy-button::before），
          复制成功态切 .copied 换对勾 —— 均为样式表内一次性定义，不占 HTML 体积 */}
      <button
        type="button"
        className="copy-button"
        data-copy
        tabIndex={-1}
        aria-label="复制行内代码"
        title="复制"
      />
    </span>
  );
}
