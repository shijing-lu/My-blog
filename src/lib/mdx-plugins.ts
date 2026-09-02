/**
 * MDX 渲染管线：统一 remark / rehype 插件 + 指令 → JSX + TOC 采集
 *
 * <!-- 区域划分 -->
 * - Imports: remark / rehype / mdast·hast 类型
 * - Directive: remarkDirectiveToJsx（:::指令 → Admonition JSX）
 * - Toc: rehypeTocCollector（h2/h3 → TOC）
 * - Plugins: 服务端与浏览器预览共用的插件数组
 */
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrismPlus from 'rehype-prism-plus';
import rehypeKatex from 'rehype-katex';
import { toHtml } from 'hast-util-to-html';
import type { Root, RootContent, Node } from 'mdast';
import type { Element, ElementContent, Root as HastRoot } from 'hast';

/** 支持的 admonition 类型 */
export const ADMONITION_TYPES = ['note', 'tip', 'warning', 'danger', 'info'] as const;
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];

/** 目录项 */
export interface TocItem {
  /** 标题 id（由 rehype-slug 生成） */
  id: string;
  /** 标题文本（KaTeX 节点取 LaTeX 源码，纯文本展示用） */
  text: string;
  /** 级别（2=H2，3=H3，4=H4） */
  level: 2 | 3 | 4;
  /** 标题内层 HTML（含 KaTeX 渲染标记，供目录富文本渲染；纯文本场景可忽略） */
  html?: string;
}

/** 块级锚点条目（思维导图节点引用段落用） */
export interface BlockAnchorItem {
  /** 块标签（p/li/pre/blockquote/h2 等） */
  type: string;
  /** 文本摘要（前 60 字，用于失效兜底定位） */
  text: string;
}

/** 块级锚点映射：para-N → 块信息 */
export type BlockAnchorMap = Record<string, BlockAnchorItem>;

/** 需要加锚点的块级标签（思维导图「片段引用」的定位粒度） */
const BLOCK_ANCHOR_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'pre', 'blockquote', 'table', 'ul', 'ol', 'figure',
]);

/**
 * rehype 插件：给文章块级元素加稳定锚点 id（para-1, para-2, …）。
 * 必须与渲染 HTML 用同一管线（本插件加入 rehypePlugins 由 evaluate 执行），
 * 服务端再从渲染结果收集 blockMap（见 mdx.ts collectBlockMapFromHtml）。
 */
export function rehypeBlockAnchors() {
  return (tree: HastRoot) => {
    let n = 0;
    const walk = (node: Element | HastRoot): void => {
      if (node.type === 'element') {
        if (BLOCK_ANCHOR_TAGS.has(node.tagName)) {
          n += 1;
          // 保留已有 id（rehypeSlug 生成的标题锚点），仅给无 id 的块生成 para-N
          // （否则覆写标题 id 会导致右侧目录的 #slug 锚点跳转失效）
          if (!node.properties?.id) {
            node.properties = { ...(node.properties ?? {}), id: `para-${n}` };
          }
        }
        if (Array.isArray(node.children)) {
          node.children.forEach((child) => walk(child as Element));
        }
      } else if (Array.isArray(node.children)) {
        node.children.forEach((child) => walk(child as Element));
      }
    };
    walk(tree);
  };
}

/** 便捷类型：含可选 name/children 的节点 */
type DirectiveNode = Node & { name?: string; children?: Node[] };

/** 递归转换某子级数组（含嵌套） */
function transformChildren(children: Node[]): void {
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i] as DirectiveNode;
    const isDirective =
      node.type === 'containerDirective' ||
      node.type === 'leafDirective' ||
      node.type === 'textDirective';
    if (isDirective && node.name && (ADMONITION_TYPES as readonly string[]).includes(node.name)) {
      const isText = node.type === 'textDirective';
      const newNode = {
        type: isText ? 'mdxJsxTextElement' : 'mdxJsxFlowElement',
        name: 'Admonition',
        attributes: [{ type: 'mdxJsxAttribute', name: 'type', value: node.name }],
        children: node.children ?? [],
      } as unknown as RootContent;
      children[i] = newNode;
      transformChildren(node.children ?? []);
      continue;
    }
    if (Array.isArray(node.children)) {
      transformChildren(node.children);
    }
  }
}

/**
 * remark 插件：把 `:::note` 容器指令转换为 `<Admonition type="note">` JSX 节点。
 * - `containerDirective` / `leafDirective` → `mdxJsxFlowElement`
 * - `textDirective` → `mdxJsxTextElement`
 * 仅识别 ADMONITION_TYPES，其余指令原样保留。
 */
export function remarkDirectiveToJsx() {
  return (tree: Root) => {
    transformChildren(tree.children);
  };
}

/** 读取元素 class 列表 */
function classListOf(node: Element): string[] {
  // hast 的 className 类型在不同子包里声明不一（string / string[] / 混合），统一按 unknown 收窄
  const cls = node.properties?.className as unknown;
  if (Array.isArray(cls)) return cls.map((c) => String(c));
  if (typeof cls === 'string') return cls.split(/\s+/).filter(Boolean);
  return [];
}

/** 在 KaTeX 节点内找 LaTeX 源码（annotation encoding="application/x-tex"） */
function findTexSource(node: Element): string {
  let out = '';
  const walk = (n: Element | ElementContent): void => {
    if (n.type === 'element' && n.tagName === 'annotation') {
      const enc = n.properties?.encoding;
      if (enc === 'application/x-tex' && Array.isArray(n.children)) {
        out = n.children.map((c) => (c.type === 'text' ? String(c.value ?? '') : '')).join('').trim();
      }
    }
    if (n.type === 'element' && Array.isArray(n.children)) {
      n.children.forEach((c) => walk(c as ElementContent));
    }
  };
  walk(node);
  return out;
}

/**
 * 递归提取标题纯文本（目录 text 字段）：
 * - 跳过 autolink 锚点 <a>（rehype-autolink-headings 注入的 # 链接）
 * - KaTeX 节点（.katex）取 annotation 里的 LaTeX 源码，跳过 MathML/视觉区避免重复噪音
 */
function textContent(node: ElementContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  if (node.type === 'element') {
    if (node.tagName === 'a') return '';
    const classes = classListOf(node);
    if (classes.includes('katex')) return findTexSource(node);
    if (classes.includes('katex-mathml')) return '';
    if (Array.isArray(node.children)) {
      return node.children.map((child) => textContent(child as ElementContent)).join('');
    }
  }
  return '';
}

/**
 * 序列化标题内层子树为 HTML（目录 html 字段，含 KaTeX 标记）。
 * 过滤 autolink <a> 子节点；KaTeX/strong/em/code 等富文本原样保留，
 * 依赖页面已引入的 katex.min.css 即可渲染公式。
 */
function tocHtml(node: Element): string {
  const children = (node.children ?? []).filter(
    (c) => !(c.type === 'element' && (c as Element).tagName === 'a'),
  );
  return children.map((c) => toHtml(c as ElementContent)).join('');
}

/**
 * remark 插件：兼容旧式数字注脚 `[1]`
 *
 * 支持两种写法（与 GFM 标准 `[^1]` 并存）：
 * 1. 正文引用：文本中出现 `[12]` → 转为 footnoteReference（跳过链接/图片等已有语义上下文）
 * 2. 底部定义：段落以 `[1] 注释内容…` 开头 → 转为 footnoteDefinition
 *
 * 转换后的节点交给 remark-gfm 渲染：正文生成 `<sup><a href="#user-content-fn-N">[N]</a></sup>`，
 * 底部生成注脚区 `<li id="user-content-fn-N">… <a href="#user-content-fnref-N">↩</a></li>`，
 * 实现"点击 [N] 跳到底部注脚 + ↩ 跳回引用处"的双向跳转。
 */
export function remarkLegacyFootnotes() {
  return (tree: Root) => {
    const REF_RE = /\[(\d{1,3})\]/g;

    /** 拆分文本节点中的 [数字] 引用，返回新子级数组 */
    function splitTextRefs(children: Node[]): Node[] {
      const out: Node[] = [];
      for (const node of children) {
        if (node.type === 'text') {
          const value = (node as { value?: unknown }).value as string | undefined ?? '';
          let last = 0;
          let m: RegExpExecArray | null;
          REF_RE.lastIndex = 0;
          let matched = false;
          while ((m = REF_RE.exec(value)) !== null) {
            matched = true;
            if (m.index > last) {
              out.push({ type: 'text', value: value.slice(last, m.index) } as Node);
            }
            out.push({
              type: 'footnoteReference',
              identifier: m[1]!,
              label: m[1]!,
            } as unknown as Node);
            last = m.index + m[0].length;
          }
          if (!matched) {
            out.push(node);
          } else if (last < value.length) {
            out.push({ type: 'text', value: value.slice(last) } as Node);
          }
        } else {
          // 非文本节点（strong/em/行内代码/链接/图片）：不拆分其内部 [x]
          out.push(node);
        }
      }
      return out;
    }

    /** 递归遍历整棵树 */
    function walk(node: Node): void {
      const children = (node as { children?: Node[] }).children;
      if (!Array.isArray(children)) return;

      for (let i = 0; i < children.length; i += 1) {
        const child = children[i]!;
        if (child.type === 'paragraph') {
          const para = child as { children?: Node[] };
          const paraChildren = para.children ?? [];
          const first = paraChildren[0] as { type?: string; value?: unknown } | undefined;
          if (first && first.type === 'text') {
            const firstText = String(first.value ?? '');
            const defMatch = /^\[(\d{1,3})\]\s+/.exec(firstText);
            if (defMatch) {
              const id = defMatch[1]!;
              const rest: Node[] = [];
              const prefixLen = defMatch[0].length;
              if (firstText.length > prefixLen) {
                rest.push({ type: 'text', value: firstText.slice(prefixLen) } as Node);
              }
              rest.push(...paraChildren.slice(1));
              children[i] = {
                type: 'footnoteDefinition',
                identifier: id,
                label: id,
                children: [{ type: 'paragraph', children: rest }],
              } as unknown as Node;
              continue;
            }
          }
          // 段落内文本引用（仅处理文本节点，链接/图片内部不动）
          para.children = splitTextRefs(paraChildren);
        } else {
          walk(child);
        }
      }
    }

    walk(tree);
  };
}

/**
 * rehype 插件：采集 h2/h3/h4 标题到 `file.data.toc`。
 * 必须在 `rehype-slug` 之后运行以获得标题 id；
 * 若管线含 `rehype-katex`，须在其之后运行，html 字段才能带上公式标记。
 */
export function rehypeTocCollector() {
  return (tree: HastRoot, file: { data: Record<string, unknown> }) => {
    const toc: TocItem[] = [];
    const walk = (node: Element | HastRoot): void => {
      if (node.type === 'element') {
        if (node.tagName === 'h2' || node.tagName === 'h3' || node.tagName === 'h4') {
          const id = node.properties?.id;
          if (typeof id === 'string') {
            const level = node.tagName === 'h2' ? 2 : node.tagName === 'h3' ? 3 : 4;
            toc.push({
              id,
              text: textContent(node).trim() || id,
              level,
              html: tocHtml(node) || undefined,
            });
          }
        }
        if (Array.isArray(node.children)) {
          node.children.forEach((child) => walk(child as Element));
        }
      } else if (Array.isArray(node.children)) {
        node.children.forEach((child) => walk(child as Element));
      }
    };
    walk(tree);
    file.data.toc = toc;
  };
}

/** remark 插件数组（evaluate 与预览共用） */
export const remarkPlugins = [remarkGfm, remarkMath, remarkDirective, remarkDirectiveToJsx, remarkLegacyFootnotes];

/** rehype 插件数组：slug → autolink → katex（LaTeX 公式，纯 CSS 渲染无需客户端 JS）→ prism（行号）→ 块锚点（思维导图引用） */
export const rehypePlugins = [
  rehypeSlug,
  rehypeAutolinkHeadings,
  [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
  [rehypePrismPlus, { showLineNumbers: true, ignoreMissing: true }],
  rehypeBlockAnchors,
];
