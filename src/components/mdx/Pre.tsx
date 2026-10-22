/**
 * Pre 组件 —— 代码块包装（右上角工具栏：折叠/展开 + 图标复制按钮）
 *
 * MDX 中 `pre` 元素映射到本组件：
 * - 渲染 `<pre data-code-block>`，并注入两个控件：
 *   ① **折叠/展开**（`[data-code-toggle]`）：仅 `data-collapsible="true"` 时渲染 ——
 *      该标记由 rehype 插件 `rehypeCodeBlockMeta` 按行数阈值（15 行）标注，
 *      短代码块不挂控件（两行片段上的「收起」是视觉噪音）；
 *   ② **复制**（`[data-copy]`）：始终渲染，逻辑见 copy-button.ts。
 * - 用 `CodeBlockContext.Provider` 包住 `children`：让代码块内的 `code`
 *   （经 registry 映射到 InlineCode）知道自己处在块级上下文里，从而只渲染裸 `<code>`，
 *   不重复注入行内复制按钮（取舍见 CodeBlockContext.ts）。
 * - ⚠️ className 必须与 MDX 传入的 props.className（rehype-prism-plus 的
 *   "language-xx code-highlight"）合并——直接 `{...props}` 展开会覆盖写死的
 *   "code-block" 类，导致全部代码块样式（.prose pre.code-block）失配；
 * - 图标走 BaseLayout 的 sprite（`<use href="#i-code-*">`），与行内按钮共用，避免重复内联。
 * - 行号/高亮由 rehype-prism-plus 在处理子节点时生成。
 *
 * ## 阅读模式 / 编辑模式
 * 本组件只出现在 MDX 渲染产物中；编辑态的代码块由 CodeMirror 装饰器渲染
 * （cm-live-preview 的 CodeWidget / cm-wysiwyg 的 CodeBlockWidget），不经过 MDX 管线
 * —— 因此两个控件在编辑模式下**天然不显示**，无需运行时判断。
 */
import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { CodeBlockContext } from './CodeBlockContext';

/** 折叠态图标：向上箭头（点击可收起） */
const CHEVRON_UP = (
  <svg data-icon="collapse" className="size-3.5" aria-hidden="true">
    <use href="#i-code-chevron-up" />
  </svg>
);

/** 展开态图标：向下箭头（默认隐藏，由脚本按状态切换） */
const CHEVRON_DOWN = (
  <svg data-icon="expand" className="hidden size-3.5" aria-hidden="true">
    <use href="#i-code-chevron-down" />
  </svg>
);

/** 渲染一个带工具栏（折叠 + 复制）的代码块 */
export default function Pre({
  children,
  className,
  'data-collapsible': dataCollapsible,
  ...props
}: Omit<ComponentProps<'pre'>, 'data-collapsible'> & {
  children?: ReactNode;
  /** 由 rehypeCodeBlockMeta 按行数标注；"true" 表示达到可折叠阈值 */
  'data-collapsible'?: string;
}): ReactElement {
  const codeProps = isValidElement<{ className?: string }>(children) ? children.props : null;
  const isMermaid = Boolean(
    className?.includes('language-mermaid') || codeProps?.className?.includes('language-mermaid'),
  );

  if (isMermaid) {
    return (
      <div
        className="mermaid-block my-6 rounded-2xl border border-border/80 bg-card/60 overflow-hidden shadow-xs"
        data-mermaid-block
        data-code-block
      >
        <div className="mermaid-header flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 text-xs text-muted-foreground select-none">
          <span className="flex items-center gap-2 font-mono font-medium text-foreground">
            <svg
              className="size-4 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="8" height="6" x="8" y="2" rx="1" />
              <path d="M12 8v4" />
              <rect width="8" height="6" x="2" y="14" rx="1" />
              <rect width="8" height="6" x="14" y="14" rx="1" />
              <path d="M6 14h12" />
            </svg>
            <span>图表 / Mermaid</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="mermaid-toggle-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono border border-border/80 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
              data-mermaid-toggle
              title="切换图表与代码源码"
            >
              <span>查看代码</span>
            </button>
            <button
              type="button"
              className="copy-button p-1.5 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground cursor-pointer"
              data-copy
              aria-label="复制代码"
              title="复制代码"
            >
              <svg data-icon="copy" className="size-3.5" aria-hidden="true">
                <use href="#i-code-copy" />
              </svg>
              <svg data-icon="check" className="hidden size-3.5" aria-hidden="true">
                <use href="#i-code-check" />
              </svg>
            </button>
          </div>
        </div>
        <div className="mermaid-chart flex items-center justify-center p-6 overflow-x-auto min-h-[120px]" data-mermaid-chart>
          <div className="mermaid-loading flex items-center gap-2 text-xs text-muted-foreground py-4">
            <span className="size-2 rounded-full bg-primary animate-ping"></span>
            <span>正在渲染图表…</span>
          </div>
        </div>
        <pre
          {...props}
          className={[
            'code-block mermaid-source hidden !m-0 !rounded-none !border-0 !border-t !border-border/40',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          data-mermaid-source
        >
          <CodeBlockContext.Provider value={true}>{children}</CodeBlockContext.Provider>
        </pre>
      </div>
    );
  }

  const canCollapse = dataCollapsible === 'true';

  return (
    <pre
      data-code-block
      {...props}
      data-collapsible={dataCollapsible}
      className={['code-block', className].filter(Boolean).join(' ')}
    >
      {canCollapse && (
        <button
          type="button"
          className="collapse-toggle"
          data-code-toggle
          aria-expanded="true"
          title="收起代码"
        >
          {CHEVRON_UP}
          {CHEVRON_DOWN}
          <span data-toggle-text>收起</span>
        </button>
      )}
      <button type="button" className="copy-button" data-copy aria-label="复制代码" title="复制代码">
        {/* 复制图标（默认） */}
        <svg data-icon="copy" className="size-4" aria-hidden="true">
          <use href="#i-code-copy" />
        </svg>
        {/* 成功对勾图标（复制后） */}
        <svg data-icon="check" className="hidden size-4" aria-hidden="true">
          <use href="#i-code-check" />
        </svg>
      </button>
      <CodeBlockContext.Provider value={true}>{children}</CodeBlockContext.Provider>
    </pre>
  );
}
