import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const src = [
  '| 公式 | 说明 |',
  '|:---|:---|',
  '| $\\int \\dfrac{1}{x} \\, dx = \\ln \\mid x \\mid + C$ | 基本 |',
  '| $\\int\\dfrac{dx}{a^2-x^2} = \\dfrac{1}{2a}\\ln \\left| \\dfrac{a+x}{a-x} \\right| + C$ | 含公式字符 |',
].join('\n');

const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).runSync(
  unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src),
);

function walk(n: unknown, depth: number): void {
  const node = n as { type: string; children?: unknown[]; value?: string };
  if (node.type === 'text') {
    console.log('  '.repeat(depth) + 'TEXT: ' + JSON.stringify(node.value));
  } else if (node.type === 'inlineMath' || node.type === 'math') {
    console.log('  '.repeat(depth) + node.type + ': ' + JSON.stringify(node.value));
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) walk(c, depth + 1);
  }
}
walk(tree, 0);
