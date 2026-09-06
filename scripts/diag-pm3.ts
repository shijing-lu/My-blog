import { readFileSync, readdirSync } from 'node:fs';
import { renderMdx, normalizeMathFences } from '../src/lib/mdx';
const PATTERNS = ['A^k =', 'pmatrix', 'Ax = 0 \\ Bx = 0'];
const files = readdirSync('.diag/full-src').filter((x) => x.endsWith('.md'));
(async () => {
  for (const f of files) {
    const text = readFileSync(`.diag/full-src/${f}`, 'utf8');
    for (const pat of PATTERNS) {
      const idx = text.indexOf(pat);
      if (idx < 0) continue;
      const start = text.lastIndexOf('\n', idx - 200) + 1;
      const end = text.indexOf('\n', idx + 500);
      const slice = text.slice(start, end === -1 ? undefined : end);
      try {
        const r = await renderMdx(slice);
        const ec = (r.html.match(/katex-error/g) ?? []).length;
        if (ec > 0) {
          const m = r.html.match(/<span class="katex-error[^>]*>([\s\S]{0,200}?)<\/span>/);
          console.log('!!', f.slice(0, 30), 'pat=' + pat, 'errs', ec, '|', m?.[1]?.replace(/<[^>]+>/g, '').slice(0, 120));
          console.log('  slice:', JSON.stringify(slice.slice(0, 180)));
        }
      } catch (e) { console.log('THROW', f.slice(0, 30), (e as Error).message.slice(0, 80)); }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
