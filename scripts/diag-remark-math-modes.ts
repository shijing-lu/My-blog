/** remark-math（micromark mathFlow）对各形态 $$ 的识别测试 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';

const CASES: Array<[string, string]> = [
  ['标准独立fence', '前文\n\n$$\nx^2\n$$\n\n后文'],
  ['同行成对', '前文\n\n$$x^2$$\n\n后文'],
  ['open独立+行尾闭', '前文\n\n$$\nx^2$$\n\n后文'],
  ['open同行内容+独立闭', '前文\n\n$$ x^2 + y\n\n后文'],
  ['行中成对', '前文 $$x^2$$ 后文'],
  ['行中open(前有字)', '前文则$$ x^2 + y\n后文'],
  ['content含$$行尾+后续独立$$', '前文\n\n$$\\begin{cases}\na \\\\ b\n\\end{cases} $$\n\n后文$$'],
];

(async () => {
  for (const [name, src] of CASES) {
    const tree = unified().use(remarkParse).use(remarkMath).parse(src);
    const mathNodes: string[] = [];
    visit(tree, 'math', (n: { value?: string }) => mathNodes.push((n.value ?? '').slice(0, 80).replace(/\n/g, '\\n')));
    const parts = tree.children.map((c: { type?: string; value?: string }) => {
      const t = c.type ?? '?';
      if (t === 'text' && typeof c.value === 'string') {
        return t + ':' + c.value.slice(0, 50).replace(/\n/g, '⏎');
      }
      return t;
    });
    console.log('\n[' + name + ']');
    console.log('  math 节点数:', mathNodes.length, mathNodes.length ? 'value=' + JSON.stringify(mathNodes) : '');
    console.log('  顶层:', parts.join(' | ').slice(0, 180));
  }
})().catch((e) => { console.error(e); process.exit(1); });
