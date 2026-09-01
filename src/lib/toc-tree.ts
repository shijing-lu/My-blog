/**
 * 目录树：扁平 TocItem[] → 嵌套树 + HTML 字符串渲染
 *
 * 使用方：
 * - SSR：doc/[id].astro frontmatter（set:html 渲染初始目录）
 * - 客户端：doc/[id].astro script（左栏切换文章后重建目录）
 * 两端共用同一实现，保证结构一致。
 */
import type { TocItem } from './mdx-plugins';

/** 树节点 */
export interface TocNode {
  item: TocItem;
  children: TocNode[];
}

/**
 * 扁平目录 → 树（栈式挂载：level 更深则成为上一节点子级；
 * 跳级如 h2 后直接 h4 时，挂到最近的浅级节点下）
 */
export function buildTocTree(toc: TocItem[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const item of toc) {
    const node: TocNode = { item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.item.level >= item.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return roots;
}

/** HTML 转义（仅用于无 html 字段时的纯文本回退） */
function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });
}

/** 折叠箭头（展开朝下；folded 态由 CSS 旋转 -90° 朝右） */
const CHEVRON =
  '<svg class="toc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>';

function renderNode(node: TocNode): string {
  const { item, children } = node;
  // html 字段是渲染管线产物（含 KaTeX 标记），直接注入；否则转义纯文本
  const inner = item.html && item.html.length > 0 ? item.html : escHtml(item.text);
  const toggle =
    children.length > 0
      ? `<button type="button" class="toc-fold" aria-expanded="true" aria-label="折叠子目录">${CHEVRON}</button>`
      : '<span class="toc-fold-spacer" aria-hidden="true"></span>';
  const kids =
    children.length > 0 ? `<div class="toc-children">${children.map(renderNode).join('')}</div>` : '';
  return `<div class="toc-node"><div class="toc-row">${toggle}<a class="toc-item toc-l${item.level}" data-doc-anchor href="#${item.id}">${inner}</a></div>${kids}</div>`;
}

/** 渲染整棵目录树为 HTML 字符串（无目录返回空串） */
export function renderTocTreeHtml(toc: TocItem[]): string {
  return buildTocTree(toc).map(renderNode).join('');
}
