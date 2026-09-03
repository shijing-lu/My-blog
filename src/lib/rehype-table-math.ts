/**
 * rehype-table-math.ts —— 表格单元格内 `$…$` 数学公式二次渲染插件
 *
 * 背景：
 * remark-math 的 `$…$` 行内数学在 GFM 表格单元格内不激活（micromark 局限，详见
 * src/lib/mdx.ts normalizeMathFences 文档），公式以裸文本进入 rehype 阶段。
 * 本插件在 rehype 阶段二次扫描每个 td/th 的 text 节点，匹配成对 `$…$` 段，
 * 用 KaTeX 渲染为完整 hast 元素树替换原文本，使表格内公式最终以排版后的数学呈现。
 *
 * 设计要点：
 * - 严格单 text 节点内匹配（不跨元素边界），避免误伤 `<em>`/`<a>` 等；
 * - 仅匹配单 `$…$`（行内）；`$$…$$` 由 remark-math mathFlow 处理（独立成行的 fence
 *   在 GFM table cell 同样不激活，但暂不二次渲染以保稳定，可后续扩展）；
 * - KaTeX throwOnError:false：单条公式语法错只让该段变源码（不影响整页）；
 * - KaTeX 输出 `output:'htmlAndMathml'` 含 .katex-html 与 .katex-mathml（与正文 KaTeX
 *   一致），复用 BaseLayout 的字体韧性（fonts 失败时 MathML 兜底）；
 * - 行内（displayMode:false）：与 .prose 内 `$…$` 行为一致；
 * - 已用 `\$$` 转义的 `$` 不会被错误地匹配。
 */
import type { Plugin } from 'unified';
import type { Element, ElementContent, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { fromHtml } from 'hast-util-from-html';
import katex from 'katex';

/** 行内 $…$：非 `\$` 转义、同一行、成对、含非空内容。`$$` / 多行不在此匹配。 */
const INLINE_MATH = /(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;

const rehypeTableMath: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'td' && node.tagName !== 'th') return;
    const newChildren: ElementContent[] = [];
    for (const child of node.children) {
      if (child.type !== 'text') {
        newChildren.push(child);
        continue;
      }
      const text = child.value;
      INLINE_MATH.lastIndex = 0;
      let m: RegExpExecArray | null;
      let last = 0;
      const parts: ElementContent[] = [];
      let split = false;
      while ((m = INLINE_MATH.exec(text)) !== null) {
        const full = m[0] ?? '';
        const src = m[1] ?? '';
        if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
        const html = katex.renderToString(src, {
          displayMode: false,
          throwOnError: false,
          strict: false,
          output: 'htmlAndMathml',
        });
        // 解析为 hast 元素树（用 div 包裹再取 children 兼容 fragment API）
        const root = fromHtml(`<div>${html}</div>`, { fragment: true }).children[0] as Element | undefined;
        if (root && 'children' in root && root.children.length > 0) {
          for (const c of root.children) parts.push(c as ElementContent);
        } else {
          parts.push({ type: 'text', value: html });
        }
        last = m.index + full.length;
        split = true;
      }
      if (split) {
        if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
        newChildren.push(...parts);
      } else {
        newChildren.push(child);
      }
    }
    node.children = newChildren;
  });
};

export default rehypeTableMath;
