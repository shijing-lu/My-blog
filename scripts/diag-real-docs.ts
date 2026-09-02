import { readFileSync } from 'node:fs';
import { renderMdx, normalizeMathFences } from '../src/lib/mdx';
import { execSync } from 'node:child_process';
const files = execSync('ls .diag/doc-src-*.md', { encoding: 'utf8' }).trim().split('\n');
(async () => {
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const r = await renderMdx(src);
    const hasErr = r.html.includes('katex-error');
    const normed = normalizeMathFences(src);
    // 规整改动量
    const changedLines = src.split('\n').length !== normed.split('\n').length ? normed.split('\n').length - src.split('\n').length : 0;
    console.log((hasErr ? '!! ERR ' : 'ok clean ') + f.split('doc-src-')[1]?.slice(0, 14) + ' err=' + (r.html.match(/katex-error/g) || []).length + ' 规整新增行=' + changedLines);
    if (hasErr) {
      const m = r.html.match(/<span class="katex-error[^"]*"[^>]*>([\s\S]{0,120}?)<\/span>/);
      console.log('   err head:', m ? m[1].replace(/&amp;/g, '&').slice(0, 120) : '');
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
