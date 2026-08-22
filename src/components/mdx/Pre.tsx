/**
 * Pre 组件 —— 代码块包装（带右上角复制按钮）
 *
 * MDX 中 `pre` 元素映射到本组件：
 * - 渲染 `<pre data-code-block>` 并注入复制按钮（`data-copy`）；
 * - 行号/高亮由 rehype-prism-plus 在处理子节点时生成；
 * - 交互逻辑见 `src/scripts/copy-button.ts`。
 */
import type { ComponentProps, ReactNode } from 'react';

/** 渲染一个带复制按钮的代码块 */
export default function Pre({ children, ...props }: ComponentProps<'pre'> & { children?: ReactNode }): ReactNode {
  return (
    <pre className="code-block" data-code-block {...props}>
      <button type="button" className="copy-button" data-copy aria-label="复制代码">
        复制
      </button>
      {children}
    </pre>
  );
}
