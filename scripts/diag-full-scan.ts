import { readdirSync, readFileSync } from 'node:fs';
import { renderMdx } from '../src/lib/mdx';
(async () => {
  let ok = 0, throws = 0, katexErr = 0;
  for (const f of readdirSync('.diag/full-src').filter((x) => x.endsWith('.md'))) {
    try {
      const r = await renderMdx(readFileSync(`.diag/full-src/${f}`, 'utf8'));
      ok++;
      const html = r.html;
      const re = /<span class="katex-error[^>]*>([\s\S]{0,160}?)<\/span>/g;
      const errs: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) errs.push(m[1]);
      const e = errs.length;
      if (e > 0) {
        katexErr++;
        const first = errs[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 120);
        console.log('!!', f.slice(0, 40), 'errs', e, '|', first);
      }
    } catch { throws++; }
  }
  console.log(JSON.stringify({ total: ok + throws, ok, throws, katexErr }));
})().catch((e) => { console.error('outer', e); process.exit(1); });
