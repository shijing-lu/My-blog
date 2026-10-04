/**
 * 裸 `<` 兜底：标签名后继字符校验（回归测试）
 *
 * 背景（2026-09-21 实测）：桌面端文章《计算机组成》整篇 500，报
 * `Unexpected character \`。\` (U+3002) in name` —— 正文里写了
 * `当CF=1时，说明A<B。`，`<B` 被旧逻辑判为「合法标签起始」放行，
 * 随后 MDX JSX 解析器读到中文句号直接抛错，整篇渲染失败。
 *
 * 修法：看完首字符后继续读标签名，并校验其后继字符——
 * 只有空白 / `>` / `/` / 行尾才算真标签；中文标点等一律按裸 `<` 转义。
 */
import { describe, expect, it } from 'vitest';
import { renderMdx } from '../src/lib/mdx';

describe('裸 `<` 兜底（标签名后继校验）', () => {
  it('正文里的 `A<B。` 不再让整篇崩，且渲染为字面 <', async () => {
    const { html } = await renderMdx('当ZF=1时，说明A=B。当CF=1时，说明A<B。');
    expect(html).toContain('A&lt;B');
  });

  it('`<0`、`< n`、`<!` 等既有形态仍被安全化', async () => {
    const { html } = await renderMdx('数组下标 <0 是非法写法；比较 n<2 与 n< 2。');
    expect(html).toContain('&lt;0');
    expect(html).toContain('n&lt;2');
  });

  it('真正的标签继续正常解析（不被误转义）', async () => {
    // 小写 HTML 标签在 MDX 里原样输出；⚠️ 未注册的大写组件（如 <Tex/>）会报
    // 「Expected component ... to be defined」，那是 MDX 的正常行为，不作为本用例
    const { html } = await renderMdx('<div class="x">hi</div>\n\n换行<br/>');
    expect(html).toContain('<div class="x">hi</div>');
    expect(html).toContain('<br/>');
  });

  it('行内代码里的 `<` 原样保留', async () => {
    const { html } = await renderMdx('用 `A<B` 表示小于关系。');
    expect(html).toContain('A&lt;B');
  });

  it('中文标点的多种后继形态都能兜住', async () => {
    for (const src of ['A<B，继续', 'A<B。句号', 'A<B（括号）', 'A<B、顿号']) {
      await expect(renderMdx(src)).resolves.toBeTruthy();
    }
  });
});

/**
 * 公式区内的 `<` 绝不能转义（2026-09-23 回归）
 *
 * 背景：用户报障「公式块多出 `/` 符号」——真题选项行 `$I_1<I_2<I_3$` 渲染成
 * `I_1\<I_2\<I_3`，解析行同理，大面积复现。
 *
 * 根因：`escapeBareLt` 对整行逐字符判据，不区分数学区，把公式里的 `<` 也转义成 `\<`。
 * 旧注释声称「KaTeX 会把 `\<` 渲染为 `<`（LaTeX 中 `\<` 是合法转义）」——**错的**：
 * `\<` 是 KaTeX 的未定义控制词，`throwOnError:false` 下整段标红（`.katex-error`）。
 * LaTeX 里确有 `\<`，但 KaTeX 不实现；`<` 在 KaTeX 数学模式下本就是合法字符。
 *
 * 修法：新增 `findInlineMathRanges`（配对规则照抄 micromark-extension-math@3.1.0 的
 * `math-text.js`：开区间吃整段 `$`，闭区间须等长），公式区内的 `<` 原样放行；
 * display 数学区段由调用方按已知的 `inDisplayMath` / `isMath` 状态直接跳过转义。
 *
 * ⚠️ 保守取向：**只在 `$` 区间闭合时才认定是公式**。落单 `$`（货币）不构成区间，
 * 该处仍照常转义 —— 最坏只是「公式里多转义一次」（即本缺陷），
 * 绝不把裸 `<` 漏给 JSX 解析器（那会整篇 500）。
 */
describe('公式区内的 `<` 不被转义', () => {
  /**
   * KaTeX 实际收到的 TeX 源（从 MathML annotation 读回，最贴近真实输入）。
   *
   * ⚠️ annotation 里的内容在**序列化后的 HTML 里是实体转义的**：`<` 会写成 `&lt;`。
   * 所以必须先解码再断言 —— 否则「`a<0`（正确）」与「`a\<0`（缺陷）」都会
   * 以 `a&lt;0` / `a\&lt;0` 的形式出现，直接比较会误判。
   */
  const texSources = (html: string): string[] =>
    [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)</g)].map((m) =>
      m[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'),
    );

  it('行内公式 `$a<0$` 里的 `<` 原样交给 KaTeX', async () => {
    const { html } = await renderMdx('比较 $a<0$ 成立。');
    expect(html).not.toContain('\\<');
    expect(html).not.toContain('katex-error');
    expect(texSources(html)).toEqual(['a<0']);
  });

  it('`<` 后跟字母（最像标签起始）也不被转义', async () => {
    const { html } = await renderMdx('设 $a<b$ 成立。');
    expect(html).not.toContain('\\<');
    expect(texSources(html)).toEqual(['a<b']);
  });

  it('真题原句：多个比较式全部保持裸 `<`（用户报障场景）', async () => {
    const { html } = await renderMdx(
      '（2012 数一二）$I_k=\\int_0^{k\\pi}e^{x^2}\\sin xdx\\ (k=1,2,3)$，则：A. $I_1<I_2<I_3$；B. $I_3<I_2<I_1$',
    );
    expect(html).not.toContain('\\<');
    expect(html).not.toContain('katex-error');
    const tex = texSources(html);
    expect(tex).toHaveLength(3);
    expect(tex[1]).toBe('I_1<I_2<I_3');
    expect(tex[2]).toBe('I_3<I_2<I_1');
  });

  it('display 数学（`$$…$$`）里的 `<` 同样原样保留', async () => {
    const { html } = await renderMdx('$$\nx<0\\quad y>1\n$$');
    expect(html).not.toContain('\\<');
    expect(html).not.toContain('katex-error');
    expect(texSources(html)).toEqual(['x<0\\quad y>1']);
  });

  it('公式外（非数学区）的裸 `<` 仍然照常转义 —— 防 500 的兜底不能丢', async () => {
    const { html } = await renderMdx('价格 $5 到 $10 之间，误差 <0.5。');
    // 落单 `$` 不构成区间 → 该行仍是普通文本 → `<0.5` 必须被转义
    expect(html).toContain('&lt;0.5');
  });

  it('公式内外混排：各自按自己的规则处理', async () => {
    const { html } = await renderMdx('误差 <0.5，而公式 $a<b$ 成立。');
    expect(html).toContain('&lt;0.5'); // 公式外转义
    expect(html).not.toContain('\\<'); // 公式内不转义
    expect(texSources(html)).toEqual(['a<b']);
  });

  it('转义美元 `\\$` 不会误开公式区间', async () => {
    const { html } = await renderMdx('美元符号 \\$ 与公式 $x<1$。');
    expect(html).not.toContain('\\<');
    expect(texSources(html)).toEqual(['x<1']);
  });

  it('未闭合的 `$` 不构成公式区间（fail-safe：宁多转义，不漏裸 <）', async () => {
    const { html } = await renderMdx('价格 $5 起，误差 <0.5。');
    expect(html).toContain('&lt;0.5');
  });

  it('不等长 `$` 串（`$a$$b$`）不抛错 —— 区间判定与 KaTeX 各自容错', async () => {
    // `$a$$b$`：开区间长 1，中间的 `$$` 不等长 → 本函数按 micromark 规则把它当内容。
    // ⚠️ 但 normalizeMathFences 的 `$$` 拆行逻辑会先把 `$$` 提成独立 fence 行，
    //    导致这里 KaTeX 收到未闭合内容而报红 —— 那是**既有的** `$$` 拆行行为，
    //    与本次 `<` 修复无关（该输入不含 `<`，escapeBareLt 的输出前后逐字节相同）。
    //    这里只锁「不崩」，红字问题另记入发现清单，不在本次范围内。
    await expect(renderMdx('看 $a$$b$ 结束。')).resolves.toBeTruthy();
  });

  it('表格 cell 与引用块里的公式同样不转义', async () => {
    const table = await renderMdx('| 条件 | 结论 |\n| :--- | :--- |\n| $a<0$ | 递减 |');
    expect(table.html).not.toContain('\\<');
    const quote = await renderMdx('> [!tip] 提示\n> 因为 $a<b$，所以成立。');
    expect(quote.html).not.toContain('\\<');
  });
});

