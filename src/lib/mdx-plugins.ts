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
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrismPlus from 'rehype-prism-plus';
import type { Root, RootContent, Node } from 'mdast';
import type { Element, ElementContent, Root as HastRoot } from 'hast';

/** 支持的 admonition 类型 */
export const ADMONITION_TYPES = ['note', 'tip', 'warning', 'danger', 'info'] as const;
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];

/** 目录项 */
export interface TocItem {
  /** 标题 id（由 rehype-slug 生成） */
  id: string;
  /** 标题文本 */
  text: string;
  /** 级别（2=H2，3=H3） */
  level: 2 | 3;
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

/** 递归提取元素文本（跳过 autolink 锚点子节点） */
function textContent(node: ElementContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  if ('tagName' in node && node.tagName === 'a') return '';
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map((child) => textContent(child as ElementContent)).join('');
  }
  return '';
}

/**
 * rehype 插件：采集 h2/h3 标题到 `file.data.toc`。
 * 必须在 `rehype-slug` 之后运行以获得标题 id。
 */
export function rehypeTocCollector() {
  return (tree: HastRoot, file: { data: Record<string, unknown> }) => {
    const toc: TocItem[] = [];
    const walk = (node: Element | HastRoot): void => {
      if (node.type === 'element') {
        if (node.tagName === 'h2' || node.tagName === 'h3') {
          const id = node.properties?.id;
          if (typeof id === 'string') {
            toc.push({
              id,
              text: textContent(node).trim() || id,
              level: node.tagName === 'h2' ? 2 : 3,
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
export const remarkPlugins = [remarkGfm, remarkDirective, remarkDirectiveToJsx];

/** rehype 插件数组：slug → autolink → prism（行号） */
export const rehypePlugins = [
  rehypeSlug,
  rehypeAutolinkHeadings,
  [rehypePrismPlus, { showLineNumbers: true, ignoreMissing: true }],
];
