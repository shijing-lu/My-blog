import { renderMdx } from '../src/lib/mdx';
const tests = [
  ['A^k 公式', '$A^k = \\begin{cases} E, & k \\text{为偶数} \\\\ A, & k \\text{为奇数} \\end{cases}$'],
  ['分块矩阵', '$\\begin{pmatrix}A & O \\\\ O & B\\end{pmatrix}$'],
  ['cases-AxBx', '$\\begin{cases}Ax = 0 \\\\ Bx = 0\\end{cases}$'],
];
(async () => {
  for (const [name, src] of tests) {
    const r = await renderMdx(src);
    const errs = r.html.match(/<span class="katex-error[^>]*>([\s\S]{0,200}?)<\/span>/g);
    console.log(name, 'errs:', errs?.length ?? 0, '|', errs?.[0]?.replace(/<[^>]+>/g, '').slice(0, 120));
  }
})().catch((e) => { console.error(e); process.exit(1); });
