/**
 * Pre 组件 —— 代码块包装（右上角图标复制按钮）
 *
 * MDX 中 `pre` 元素映射到本组件：
 * - 渲染 `<pre data-code-block>` 并注入复制按钮（`data-copy`）；
 * - 复制/成功状态用「复制」/「对勾」两枚内联 SVG 图标切换（见 copy-button.ts）；
 * - 行号/高亮由 rehype-prism-plus 在处理子节点时生成。
 */
import type { ComponentProps, ReactNode } from 'react';

/** 渲染一个带图标复制按钮的代码块 */
export default function Pre({ children, ...props }: ComponentProps<'pre'> & { children?: ReactNode }): ReactNode {
  return (
    <pre className="code-block" data-code-block {...props}>
      <button type="button" className="copy-button" data-copy aria-label="复制代码" title="复制代码">
        {/* 复制图标（默认） */}
        <svg data-icon="copy" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {/* 成功对勾图标（复制后） */}
        <svg data-icon="check" className="hidden size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>
      {children}
    </pre>
  );
}
