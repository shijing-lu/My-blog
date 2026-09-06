/** 验证表格 cell 内 $…$ 公式在阅读模式被 KaTeX 真实渲染（不再是字面 LaTeX） */
import { renderMdx } from '../src/lib/mdx';
const T = '| 公式 | 备注 |\n| --- | --- |\n| $\\int \\dfrac{dx}{a^2-x^2} = \\dfrac{1}{2a}\\ln \\left| \\dfrac{a+x}{a-x} \\right| + C$ | 基础积分 |\n| $E = mc^2$ | 质能方程 |';
(async () => {
  const r = await renderMdx(T);
  // 在 <table> 段内查找 katex 元素
  const tableMatch = r.html.match(/<table[\s\S]*?<\/table>/);
  const table = tableMatch ? tableMatch[0] : '(no table)';
  console.log('含 katex:', r.html.includes('katex'), '| 表格内 katex:', table.includes('katex'));
  console.log('表格中 <span class="katex-html">:', table.includes('katex-html'));
  console.log('是否含字面 "$" + \\dfrac:', table.includes('$ \\dfrac'));
  console.log('--- table HTML (truncated) ---');
  console.log(table.replace(/></g, '>\n<').slice(0, 1200));
})().catch((e) => { console.error(e); process.exit(1); });
