import { readFileSync } from 'node:fs';
import { renderMdx, normalizeMathFences } from '../src/lib/mdx';
import katex from 'katex';
// 找第3章「一元函数积分学」含 \frac 或 \dfrac 公式
const f = '.diag/full-src/5d69ce83-0957-4b3b-a929-3c85ddc29f05_第3章_一元函数积分学（强化讲义）.md';
const src = readFileSync(f, 'utf8');
// 找含 \frac 的行
src.split('\n').forEach((l, i) => {
  if (l.includes('\\frac') || l.includes('\\dfrac') || l.includes('\\int')) {
    if (i < 50 || (i > 50 && i < 120)) {
      // 模拟表格行 normalize
      const t = normalizeMathFences(l);
      const stripped = t.match(/\|.*?\|/)?.[0] ?? '';
      if (stripped.includes('\\frac') || stripped.includes('\\dfrac')) {
        console.log('L' + (i + 1) + ':', l.slice(0, 130));
        console.log('   norm:', stripped.slice(0, 130));
        // 直接 katex render 该段
        const m = stripped.match(/\$\$(.*)\$\$|\$(.*)\$/);
        if (m) {
          const src1 = (m[1] ?? m[2] ?? '').trim();
          console.log('   src in $:', src1.slice(0, 100));
          try {
            const h = katex.renderToString(src1, { throwOnError: false, output: 'htmlAndMathml' });
            console.log('   has katex-error:', h.includes('katex-error'));
          } catch (e) { console.log('   katex THROW'); }
        }
      }
    }
  }
});
