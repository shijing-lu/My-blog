import katex from 'katex';
const cases = ['\\begin{cases}E, & k \\text{为偶数} \\\\ A, & k \\text{为奇数} \\end{cases}',
               '\\begin{pmatrix}A & O \\\\ O & B\\end{pmatrix}',
               '\\begin{cases}Ax = 0 \\\\ Bx = 0\\end{cases}'];
for (const src of cases) {
  try {
    const h = katex.renderToString(src, { throwOnError: false, strict: false, output: 'htmlAndMathml' });
    console.log('  has error span:', h.includes('katex-error'), '| len', h.length);
    if (h.includes('katex-error')) console.log('  err snippet:', h.match(/<span class="katex-error[^>]*>([^<]*)<\/span>/)?.[1]);
  } catch (e) { console.log('THROW:', (e as Error).message); }
}
