import { readFileSync, readdirSync } from 'node:fs';
import { renderMdx } from '../src/lib/mdx';
const files = readdirSync('.diag/full-src').filter((x) => x.endsWith('.md'));
(async () => {
  for (const f of files) {
    const src = readFileSync(`.diag/full-src/${f}`, 'utf8');
    let r;
    try { r = await renderMdx(src); } catch { continue; }
    const errs: Array<{ idx: number; text: string }> = [];
    const re = /<span class="katex-error[^>]*>([\s\S]{0,160}?)<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(r.html)) !== null) {
      errs.push({ idx: m.index, text: m[1].replace(/<[^>]+>/g, '').slice(0, 100) });
    }
    if (errs.length === 0) continue;
    // 按 err idx 推测原文件行（html 内容里搜错误文本）
    for (const e of errs) {
      const sample = e.text.match(/[A-Za-z\\^{}_]+\{[^}]*\}/)?.[0] ?? e.text.slice(0, 40);
      const origIdx = src.indexOf(sample.replace(/\\\{/g, '{').replace(/\\\}/g, '}'));
      let line = '?';
      if (origIdx >= 0) line = String(src.slice(0, origIdx).split('\n').length);
      console.log(f.slice(0, 30), '|line', line, '|', e.text.slice(0, 80));
    }
  }
})().catch((e) => { console.error('outer', e); process.exit(1); });
