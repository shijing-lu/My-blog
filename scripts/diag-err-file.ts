import { readdirSync, readFileSync } from 'node:fs';
import { renderMdx } from '../src/lib/mdx';
(async () => {
  for (const f of readdirSync('.diag/full-src').filter((x) => x.endsWith('.md'))) {
    try { await renderMdx(readFileSync(`.diag/full-src/${f}`, 'utf8')); }
    catch (e) {
      const err = e as { place?: { line?: number; column?: number }; reason?: string };
      console.log('!! THROW', f.slice(0, 50), '| line', err.place?.line, 'col', err.place?.column, '|', (err.reason ?? '').slice(0, 80));
    }
  }
})();
