import { readFileSync } from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkTableBrace from '../src/lib/remark-table-brace';

const lines = readFileSync('.diag/full-src/5d69ce83-0957-4b3b-a929-3c85ddc29f05_第3章_一元函数积分学（强化讲义）.md', 'utf8').split('\n');
const src = lines[49];
console.log('orig row:', src);
const mdast = unified().use(remarkParse).use(remarkGfm).use(remarkMath).runSync(unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src));
console.log('parse top:', mdast.type, 'children', mdast.children.length, mdast.children.map((c) => c.type).join(','));
// 找 table
const tbl = mdast.children.find((c) => c.type === 'table');
if (tbl) {
  console.log('table rows:', tbl.children.length);
  for (let ri = 0; ri < tbl.children.length; ri++) {
    const r = tbl.children[ri];
    if (r.type !== 'tableRow') continue;
    for (let ci = 0; ci < r.children.length; ci++) {
      const cell = r.children[ci];
      console.log(`  R${ri}C${ci}: children`, cell.children.map((ch) => ch.type + (ch.type === 'text' ? ':' + (ch as { value: string }).value.slice(0, 100) : '')).join(' | '));
    }
  }
} else {
  console.log('no table found');
}
console.log('---after remarkTableBrace transform---');
const mdast2 = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkTableBrace).runSync(unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src));
const tbl2 = mdast2.children.find((c) => c.type === 'table');
if (tbl2) {
  for (let ri = 0; ri < tbl2.children.length; ri++) {
    const r = tbl2.children[ri];
    if (r.type !== 'tableRow') continue;
    for (let ci = 0; ci < r.children.length; ci++) {
      const cell = r.children[ci];
      console.log(`  R${ri}C${ci}: children`, cell.children.map((ch) => ch.type + (ch.type === 'text' ? ':' + (ch as { value: string }).value.slice(0, 100) : '')).join(' | '));
    }
  }
}
