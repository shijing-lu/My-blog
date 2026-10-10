import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { scanMarkdownColumns } from "./markdown-columns";
import { scanVisualDirectives } from "./markdown-visual-directives";
import { scanMarkdownCallouts } from "./markdown-callouts";
interface Range {
  from: number;
  to: number;
}
/** Chunk only between complete top-level Markdown containers, preserving every byte. */
export function documentChunks(source: string, maxCharacters: number) {
  const ast = unified().use(remarkParse).use(remarkGfm).parse(source);
  const spans: Range[] = ast.children.flatMap((n) =>
    n.position?.start.offset !== undefined &&
    n.position?.end.offset !== undefined
      ? [{ from: n.position.start.offset, to: n.position.end.offset }]
      : [],
  );
  spans.push(
    ...scanMarkdownColumns(source),
    ...scanVisualDirectives(source),
    ...scanMarkdownCallouts(source),
  );
  spans.sort((a, b) => a.from - b.from || b.to - a.to);
  const merged: Range[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.from < last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  const boundaries = [
    ...new Set([...merged.map((s) => s.from), source.length]),
  ].sort((a, b) => a - b);
  const chunks: Range[] = [];
  let from = 0,
    to = 0;
  for (const boundary of boundaries) {
    if (boundary - from > maxCharacters) {
      if (to === from)
        throw new Error(
          "单个 Markdown 容器超过当前上下文额度，请在该容器内部选中内容处理，或提高编辑上下文设置",
        );
      chunks.push({ from, to });
      from = to;
      if (boundary - from > maxCharacters)
        throw new Error("单个 Markdown 容器过大，无法保持结构完整地分批");
    }
    to = boundary;
  }
  if (to > from) chunks.push({ from, to });
  return chunks.map((range, index) => ({
    ...range,
    index,
    source: source.slice(range.from, range.to),
  }));
}
export function documentOutline(source: string) {
  return source
    .split("\n")
    .filter((line) => /^#{1,6}\s/.test(line))
    .slice(0, 500)
    .join("\n");
}
