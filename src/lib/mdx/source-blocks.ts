import type { Root } from "mdast";
import type { SourceBlock } from "../mindmap-types";
import { interactiveOptions } from '../interactive-html';

// Browser-safe fingerprint. Article versions themselves use SHA-256 on the server.
export function blockFingerprint(text: string): string {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${text.length}`;
}
interface AstNode {
  type: string;
  name?: string;
  value?: string;
  lang?: string;
  meta?: string;
  depth?: number;
  children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown>; sourceKey?: string };
}
function plain(node: AstNode): string {
  return node.value ?? (node.children ?? []).map(plain).join(" ");
}
export function remarkSourceBlocks() {
  return (
    tree: Root,
    file: { value?: unknown; data: Record<string, unknown> },
  ) => {
    const source = String(file.value ?? ""),
      blocks: SourceBlock[] = [],
      counts = new Map<string, number>();
    const headings: string[] = [];
    const walk = (
      node: AstNode,
      inContainer = false,
      directiveList = false,
    ): void => {
      const supported =
        [
          "heading",
          "blockquote",
          "paragraph",
          "code",
          "list",
          "table",
        ].includes(node.type) && !(directiveList && node.type === "list");
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (
        supported &&
        (!inContainer || node.type === "blockquote" || (node.type === 'code' && node.lang === 'html-interactive')) &&
        start !== undefined &&
        end !== undefined
      ) {
        const markdown = source.slice(start, end).replace(/\r\n?/g, "\n");
        const interactive = node.type === 'code' && node.lang === 'html-interactive';
        let interactiveTitle = '交互演示';
        if (interactive) try { interactiveTitle = interactiveOptions(node.meta).title; } catch { /* Invalid blocks retain a navigable placeholder. */ }
        const text = (interactive ? interactiveTitle : plain(node))
          .replace(/[\uE000-\uE01F]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (node.type === "heading") {
          headings.length = (node.depth ?? 1) - 1;
          headings[(node.depth ?? 1) - 1] = text;
        }
        const callout =
          node.type === "blockquote" && /^>\s*\[!\s*[\w-]+\]/.test(markdown);
        const fingerprint = blockFingerprint(markdown),
          ordinal = (counts.get(fingerprint) ?? 0) + 1;
        counts.set(fingerprint, ordinal);
        const key = `${fingerprint}-${ordinal}`;
        const title = callout
          ? markdown
              .split("\n")[0]!
              .replace(/^>\s*\[![^\]]+\][+-]?\s*/, "")
              .replace(/[*`]/g, "")
              .trim() || "引用卡片"
          : text.slice(0, 80) || "内容块";
        blocks.push({
          key,
          blockId: "",
          kind: interactive ? 'interactive-html' : callout ? "callout" : node.type,
          title,
          text,
          // Quoted/indented code offsets start after the container prefix. Keep
          // the parsed program whole for later sourceRef previews.
          markdown: interactive ? (() => {
            const body = node.value || '';
            let length = 3;
            for (const match of body.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
            const fence = '`'.repeat(length);
            return `${fence}html-interactive${node.meta ? ` ${node.meta}` : ''}\n${body}\n${fence}`;
          })() : markdown,
          fingerprint,
          headingPath: headings.filter(Boolean).join(" / "),
          before: "",
          after: "",
          ...(node.type === "heading" ? { level: node.depth } : {}),
        });
        node.data = {
          ...node.data,
          sourceKey: key,
          hProperties: { ...node.data?.hProperties, "data-source-key": key },
        };
      }
      const transformedList =
        node.type === "containerDirective" &&
        ["tabs", "collapse", "columns"].includes(node.name ?? "");
      if (node.type === "list" && directiveList) {
        // Control labels become tab buttons / summary labels, so their paragraphs do not survive in the body DOM.
        for (const item of node.children ?? [])
          for (const child of (item.children ?? []).slice(1))
            walk(child, inContainer);
        return;
      }
      for (const child of node.children ?? [])
        walk(
          child,
          inContainer ||
            ["blockquote", "table"].includes(node.type) ||
            (node.type === "list" && !directiveList),
          transformedList,
        );
    };
    walk(tree as unknown as AstNode);
    blocks.forEach((block, i) => {
      block.before = blocks[i - 1]?.fingerprint ?? "";
      block.after = blocks[i + 1]?.fingerprint ?? "";
    });
    file.data.sourceBlocks = blocks;
  };
}
