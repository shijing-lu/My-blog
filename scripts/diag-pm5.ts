import { renderMdx, normalizeMathFences } from '../src/lib/mdx';
const lines = [
  '$$',
  '\\begin{cases}',
  'a_{11}x_1 + a_{12}x_2 + \\cdots + a_{1n}x_n = b_1, \\\\',
  'a_{21}x_1 + a_{22}x_2 + \\cdots + a_{2n}x_n = b_2, \\\\',
  '\\cdots\\cdots\\cdots\\cdots\\cdots\\cdots\\cdots\\cdots\\cdots \\\\',
  'a_{m1}x_1 + a_{m2}x_2 + \\cdots + a_{mn}x_n = b_m.',
  '\\end{cases}',
  '$$',
];
const src = lines.join('\n');
console.log('normalized:', JSON.stringify(normalizeMathFences(src), null, 0));
(async () => {
  const r = await renderMdx(src);
  const errs = r.html.match(/<span class="katex-error[^>]*>([\s\S]{0,200}?)<\/span>/g);
  console.log('errs:', errs?.length, '|', errs?.[0]?.replace(/<[^>]+>/g, '').slice(0, 150));
  console.log('len', r.html.length);
})().catch((e) => { console.error(e); process.exit(1); });
