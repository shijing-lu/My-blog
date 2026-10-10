/** `:::columns` + `::column` → 块级 MDX 组件。列内保留原 mdast 子树。 */
import type { Node, Root } from 'mdast';
import { jsxAttr, jsxFlow, type MdxDirectiveNode } from './nodes';
import { scanMarkdownColumns } from '../markdown-columns';
import { quotedMarkdownSegments } from '../markdown-callouts';

type Container = MdxDirectiveNode & { children: Node[] };

function convert(children: Node[], source: string, validStarts: Set<number>): void {
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index] as MdxDirectiveNode;
    if (node.type === 'containerDirective' && node.name === 'columns' && Array.isArray(node.children)) {
      const sections: Node[][] = [];
      let valid = true;
      for (const child of node.children) {
        const marker = child as MdxDirectiveNode;
        if (marker.type === 'leafDirective' && marker.name === 'column') {
          sections.push([]);
        } else if (sections.length === 0) {
          valid = false;
          break;
        } else {
          sections[sections.length - 1]!.push(child);
        }
      }
      if (valid && validStarts.has(node.position?.start.offset ?? -1) && (sections.length === 2 || sections.length === 3)) {
        // Transform nested directives only inside a recognized column. Unknown/invalid
        // containers remain available to the author's source editor unchanged.
        for (const section of sections) convert(section, source, validStarts);
        const columns = sections.map((section, column) =>
          jsxFlow('Column', [jsxAttr('number', String(column + 1))], section),
        );
        children[index] = jsxFlow('Columns', [jsxAttr('count', String(sections.length))], columns);
        continue;
      }
      // Unknown directives would discard their markers. Keep invalid groups visible
      // as literal Markdown, including every column's contents.
      children[index] = { type: 'code', lang: 'markdown', value: source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? source.length) } as Node;
      continue;
    }
    if (Array.isArray((node as Container).children)) convert((node as Container).children, source, validStarts);
  }
}

export function remarkColumns() {
  return (tree: Root, file: { value: unknown }): void => {
    const source = String(file.value);
    const validStarts = new Set<number>();
    const collect = (text: string, originalOffset: (offset: number) => number): void => {
      for (const block of scanMarkdownColumns(text)) validStarts.add(originalOffset(block.from + (text.slice(block.from).match(/^ */)?.[0].length ?? 0)));
      for (const segment of quotedMarkdownSegments(text)) collect(segment.source, offset => originalOffset(segment.originalOffset(offset)));
    };
    collect(source, offset => offset);
    convert(tree.children, source, validStarts);
  };
}
