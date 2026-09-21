/**
 * Callout 组件 —— Obsidian 风格 `> [!type]` 引用块的渲染目标
 *
 * 语法（由 remarkCallout 解析）:
 *   > [!type]              默认标题，不可折叠
 *   > [!type] 自定义标题    空格分隔的自定义标题
 *   > [!type]【自定义标题】 紧贴式自定义标题
 *   > [!type]-             默认折叠（仅标题行可见）
 *   > [!type]+             默认展开（显式声明可折叠）
 *
 * 标题渲染：
 * - 标题行含富文本（加粗/公式/行内代码…）时，remarkCallout 把该行节点作为
 *   **首个 children 元素**传入（`data-callout-head` 标记的段落），组件抽出来放进
 *   `<summary>`，从而支持公式与加粗。
 * - 否则用 `title` prop（纯文本）或类型默认文案。
 *
 * 复制按钮（rawSource）：
 * - remarkCallout 把整块 blockquote 的原始 markdown 源码（含 `> [!type]` 标记、
 *   嵌套引用与内嵌代码块）经 MDX 属性传入 `rawSource`；存在时在右上角渲染
 *   复制按钮（悬停显现，触屏恒定半透明），点击复制源码——执行逻辑在
 *   scripts/callout-copy.ts（document 级委托；本组件只负责渲染标记与图标）。
 * - 按钮置于 <summary> **之外**（兄弟节点）：点击不会触发折叠切换，
 *   且折叠收起时按钮仍悬浮在标题行右上角可用。
 *
 * 折叠实现：**原生 `<details>/<summary>`**——
 * 浏览器原生行为在 ClientRouter 转场后自动生效，无需任何 JS 重绑，最稳妥。
 */
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';

interface CalloutProps {
  type?: string;
  title?: string;
  foldable?: string | boolean;
  collapsed?: string | boolean;
  /** 整块 callout 的原始 markdown 源码（remarkCallout 切片注入）；缺省不出复制按钮 */
  rawSource?: string;
  children?: ReactNode;
}

/** 各类型的默认文案与图标字形（纯文本，不用 emoji） */
const META: Record<string, { label: string; icon: string }> = {
  note: { label: '笔记', icon: '✎' },
  info: { label: '信息', icon: 'i' },
  tip: { label: '提示', icon: '✦' },
  success: { label: '成功', icon: '✓' },
  question: { label: '问题', icon: '?' },
  warning: { label: '警告', icon: '!' },
  failure: { label: '失败', icon: '✕' },
  danger: { label: '危险', icon: '⚡' },
  bug: { label: '缺陷', icon: '⌗' },
  example: { label: '示例', icon: '≡' },
  quote: { label: '引用', icon: '❝' },
};

/** 把 prop 收窄为布尔（MDX 传进来的是字符串 "true"） */
function toBool(v: string | boolean | undefined): boolean {
  return v === true || v === 'true';
}

/**
 * 判断节点是否为「标题行段落」。
 * remarkCallout 给富标题段落注入 `data-callout-head="true"`（mdxJsxAttribute 生成），
 * 渲染后 React element 的 props 里即带该字段。
 */
function isHeadParagraph(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as { 'data-callout-head'?: string } | null;
  return props?.['data-callout-head'] === 'true';
}

/** 取出标题行段落的内容（去掉包裹标签，只保留内联节点） */
function extractHeadContent(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return null;
  const props = node.props as { children?: ReactNode } | null;
  return props?.children ?? null;
}

/** 右上角复制按钮：标记 + 三枚图标（copy 默认 / check 成功 / error 失败），行为见 callout-copy.ts */
function CopyButton({ rawSource }: { rawSource: string }): ReactNode {
  return (
    <button
      type="button"
      className="callout-copy"
      data-callout-copy
      data-callout-source={rawSource}
      aria-label="复制引用块源码"
      title="复制源码"
    >
      {/* 复制图标（默认） */}
      <svg data-icon="copy" className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {/* 成功对勾图标（复制后） */}
      <svg data-icon="check" className="hidden size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {/* 失败 ✕ 图标（复制失败后） */}
      <svg data-icon="error" className="hidden size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  );
}

/** 渲染一个 callout 提示块（可折叠时用 details/summary） */
export default function Callout({
  type = 'note',
  title,
  foldable,
  collapsed,
  rawSource,
  children,
}: CalloutProps): ReactNode {
  const safeType = META[type] ? type : 'note';
  const meta = META[safeType] ?? { label: '笔记', icon: '✎' };
  const isFoldable = toBool(foldable);
  const isCollapsed = toBool(collapsed);

  // 首个 children 可能是标题行段落（remarkCallout 在富标题场景下置于首位，
  // 其内联样式含 `data-callout-head` 标记）。识别后抽为标题内容，其余为正文。
  const list = Children.toArray(children);
  let headingSlot: ReactNode = null;
  let bodyChildren: ReactNode[] = list;
  if (list.length > 0 && isHeadParagraph(list[0])) {
    headingSlot = extractHeadContent(list[0]);
    bodyChildren = list.slice(1);
  }

  const headingContent = headingSlot ?? title ?? meta.label;

  const titleNode = (
    <>
      <span className="callout-icon" aria-hidden="true">{meta.icon}</span>
      <span className="callout-title-text">{headingContent}</span>
      {isFoldable ? <span className="callout-chevron" aria-hidden="true" /> : null}
    </>
  );

  const copyButton = rawSource ? <CopyButton rawSource={rawSource} /> : null;

  if (isFoldable) {
    return (
      <details
        className={`callout callout-${safeType} callout-foldable`}
        data-callout={safeType}
        open={!isCollapsed}
      >
        <summary className="callout-title">{titleNode}</summary>
        {copyButton}
        <div className="callout-body">{bodyChildren}</div>
      </details>
    );
  }

  return (
    <aside className={`callout callout-${safeType}`} data-callout={safeType} role="note">
      <div className="callout-title">{titleNode}</div>
      {copyButton}
      <div className="callout-body">{bodyChildren}</div>
    </aside>
  );
}
