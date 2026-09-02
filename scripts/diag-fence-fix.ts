/**
 * 修复验证：规整后坏闭 fence 不再红字；防误伤：正常内容/代码围栏/反引号行不被改动
 */
import { renderMdx, normalizeMathFences } from '../src/lib/mdx';

const BAD = `对称性性质：

$$
\\begin{cases}
2\\iint_{\\Sigma_1} R(x,y,z)\\,dxdy, & R(x,y,-z) = R(x,y,z) \\\\
0, & R(x,y,-z) = -R(x,y,z)
\\end{cases} $$
关于其他坐标面有类似结论。`;

// 防误伤样例：[[名称, 源码, 期望输出]] —— 未列 'EXPECT_SAME' 的表示应原样；
// '$$x^2$$' 同行成对 remark 本不识别（字面显示），规整应转独立行（期望改进）
const UNTOUCHED_CASES: Array<[string, string, string?]> = [
  ['正常 display 独立 fence', '$$\n\\int_0^1 x dx\n$$'],
  ['同行 $$x$$ display', '$$x^2$$', '$$\nx^2\n$$'],
  ['行内数学', '行内 $x^2$ 与 $\\frac{a}{b}$'],
  ['代码围栏内的行尾 $$', '```ts\nconst s = "x $$";\nconsole.log(s);\n```'],
  ['代码围栏无语言', '```\n$5 元 $$\n```'],
  ['含反引号行尾 $$', '文本 `code` 后 $$'],
  ['普通文本含美元', '价格 $5 与 $6 对比'],
  ['转义美元', '字面 \\$5 符号'],
];

(async () => {
  console.log('== 修复验证：坏闭 fence ==');
  const r = await renderMdx(BAD);
  console.log('katex-error:', r.html.includes('katex-error'), '(期望 false)');
  console.log('含 katex 结构:', r.html.includes('katex'), '| 含公式内容 R(x,y,z):', r.html.includes('R(x,y,z)'));
  const normBad = normalizeMathFences(BAD);
  console.log('规整后独立 $$ 行:', normBad.includes('\\end{cases}\n$$'), '| 无尾随同行 $$:', !/\\end\{cases\} \$\$\s*$/.test(normBad));

  console.log('\n== 防误伤 ==');
  let allOk = true;
  for (const [name, src, expect] of UNTOUCHED_CASES) {
    const out = normalizeMathFences(src);
    const ok = expect === undefined ? out === src : out === expect;
    if (!ok) allOk = false;
    console.log((ok ? 'OK ' : 'CHANGED!') + ' ' + name);
    if (!ok) console.log('   in :', JSON.stringify(src), '\n   out:', JSON.stringify(out));
  }
  console.log(allOk ? '\n全部符合预期 ✓' : '\n存在偏差 ✗');

  const idem = normalizeMathFences(normalizeMathFences(BAD)) === normalizeMathFences(BAD);
  console.log('幂等:', idem);
})().catch((e) => { console.error(e); process.exit(1); });
