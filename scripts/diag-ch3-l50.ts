import { renderMdx, normalizeMathFences } from '../src/lib/mdx';
import { readFileSync } from 'node:fs';
const lines = readFileSync('.diag/full-src/5d69ce83-0957-4b3b-a929-3c85ddc29f05_第3章_一元函数积分学（强化讲义）.md', 'utf8').split('\n');
const T = lines.slice(45, 60).join('\n');
console.log('--- norm ---');
console.log(normalizeMathFences(T));
(async () => {
  try {
    const r = await renderMdx(T);
    const errs = (r.html.match(/katex-error/g) ?? []).length;
    const katex = (r.html.match(/class="katex"/g) ?? []).length;
    console.log('katex#:', katex, 'katex-error#:', errs);
  } catch (e) {
    const err = e as Error & { place?: { line?: number; column?: number }; reason?: string };
    console.log('!! THROW place:', err.place, '| reason:', err.reason);
    console.log('msg:', err.message?.slice(0, 200));
  }
})().catch((e) => { console.error('outer', e); process.exit(1); });
