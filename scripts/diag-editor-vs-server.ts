/**
 * 对照实验：同一批公式源码，分别走「服务端 renderMdx（remark-math+rehype-katex）」
 * 与「编辑器侧（cm-wysiwyg 词法 + katex.renderToString）」两条路径，
 * 找出「编辑器正常、阅读模式红字」的差异来源。
 */
import { renderMdx } from '../src/lib/mdx';
import katex from 'katex';

/** 用户截图红字相似公式 + 各类边界 */
const CASES: Array<{ name: string; src: string }> = [
  { name: 'cases-重积分对称性', src: '\\begin{cases} 2\\int_{L_1} f(x,y)\\,ds, & f(-x,y) = f(x,y) \\\\ 0, & f(-x,y) = -f(x,y) \\end{cases}' },
  { name: 'cases-第一类曲面积分对称性', src: '\\begin{cases} 2\\iint_{\\Sigma_1} f(x,y,z)\\,dS, & f(x,y,-z) = f(x,y,z) \\\\ 0, & f(x,y,-z) = -f(x,y,z) \\end{cases}' },
  { name: 'bmatrix-方向余弦+行列式', src: 'dydz & dzdx & dxdy \\\\ \\dfrac{\\partial}{\\partial x} & \\dfrac{\\partial}{\\partial y} & \\dfrac{\\partial}{\\partial z} \\\\ P & Q & R \\end{bmatrix} = \\iint_S \\begin{vmatrix} \\cos\\alpha & \\cos\\beta & \\cos\\gamma \\\\ \\dfrac{\\partial}{\\partial x} & \\dfrac{\\partial}{\\partial y} & \\dfrac{\\partial}{\\partial z} \\\\ P & Q & R \\end{vmatrix} dS' },
  { name: 'iint-Sigma1', src: '\\iint_{\\Sigma_1} f(x,y,z)\\,dS' },
  { name: '多行cases', src: 'f(x)=\\begin{cases} 1, & x>0 \\\\ -1, & x<0 \\end{cases}' },
  { name: 'frac嵌套', src: '\\frac{\\frac{a}{b}}{\\frac{c}{d}}' },
  { name: '首尾空白inline', src: 'x^2 + y^2 ' },
  { name: '含换行block', src: '\\int_0^1 x^2 dx = \\frac{1}{3}' },
];

function katexRender(src: string, display: boolean): { ok: boolean; err?: string; hasErrorSpan?: boolean } {
  try {
    const html = katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, output: 'htmlAndMathml' });
    return { ok: true, hasErrorSpan: html.includes('katex-error') };
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 160) };
  }
}

(async () => {
  for (const c of CASES) {
    // 服务端：独立成 $$ 块级（display）
    const blockSrc = `测试段落。\n\n$$\n${c.src}\n$$\n\n结束。`;
    const r = await renderMdx(blockSrc);
    const hasErr = r.html.includes('katex-error');
    // 编辑器：display
    const ed = katexRender(c.src.trim(), true);
    // 编辑器 inline 版
    const inlineSrc = `行内 $${c.src}$ 测试`;
    const r2 = await renderMdx(inlineSrc);
    const edInline = katexRender(c.src.trim(), false);
    const serverBlockErr = hasErr ? r.html.match(/<span class="katex-error[^"]*"[^>]*>(.*?)<\/span>/)?.[1]?.slice(0, 120) ?? '?' : '';
    console.log(JSON.stringify({
      name: c.name,
      serverDisplayErr: hasErr,
      serverDisplayErrMsg: serverBlockErr,
      editorDisplay: ed.ok && !ed.hasErrorSpan ? 'OK' : ed.hasErrorSpan ? 'HAS_ERROR_SPAN' : ed.err,
      serverInlineErr: r2.html.includes('katex-error'),
      editorInline: edInline.ok && !edInline.hasErrorSpan ? 'OK' : edInline.hasErrorSpan ? 'HAS_ERROR_SPAN' : edInline.err,
    }));
  }
})().catch((e) => { console.error(e); process.exit(1); });
