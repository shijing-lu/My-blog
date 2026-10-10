import { compile } from "@mdx-js/mdx";
import { mdxComponents, normalizeSource, renderMdx } from "./mdx";
import { remarkPlugins } from "./mdx-plugins";

interface Node {
  type: string;
  name?: string;
  url?: string;
  value?: string;
  attributes?: Node[];
  children?: Node[];
}
const safeHtml = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
function guardTree(node: Node): void {
  if (
    [
      "mdxjsEsm",
      "mdxFlowExpression",
      "mdxTextExpression",
      "mdxJsxAttributeValueExpression",
      "mdxJsxExpressionAttribute",
    ].includes(node.type)
  ) {
    throw new Error("AI 输出包含可执行 MDX 表达式，已拒绝写入");
  }
  if (
    node.type.startsWith("mdxJsx") &&
    node.name &&
    !safeHtml.has(node.name) &&
    !(node.name in mdxComponents)
  ) {
    throw new Error(`AI 输出使用未注册的组件 ${node.name}`);
  }
  if (node.type === "mdxJsxAttribute" && node.name) {
    if (
      /^on/i.test(node.name) ||
      ["dangerouslySetInnerHTML", "srcDoc", "style"].includes(node.name)
    )
      throw new Error("AI 输出包含不安全的 HTML 属性");
    if (
      ["href", "src", "action", "xlinkHref"].includes(node.name) &&
      typeof node.value === "string"
    )
      guardUrl(node.value);
  }
  if (node.url) guardUrl(node.url);
  for (const child of [...(node.children ?? []), ...(node.attributes ?? [])])
    guardTree(child);
  if (node.value && typeof node.value === "object")
    guardTree(node.value as Node);
}
function guardUrl(value: string) {
  const clean = value.replace(/[\x00-\x20]/g, "");
  if (/^(?:javascript|vbscript|data|file):/i.test(clean))
    throw new Error("AI 输出包含不安全的链接");
}
export async function validateAiMarkdown(source: string) {
  if (!source.trim() || source.length > 500000)
    throw new Error("候选正文为空或超过 500000 字");
  // Compile is deliberately separate from evaluate: inspect every node before executing generated JSX.
  await compile(normalizeSource(source), {
    remarkPlugins: [
      () => (tree: unknown) => guardTree(tree as Node),
      ...remarkPlugins,
    ],
  });
  await renderMdx(source);
}
