/**
 * 动态渲染管线一致性测试（2026-09-20 管线统一）
 *
 * 背景：动态原先用 `renderMarkdownHtml`（仅 GFM 四插件）——数学公式/容器/高亮全部不渲染，
 * 与文章、文档的展示能力割裂。现统一为 `renderMdx`（与文章页/文档页同一套解析管线）。
 *
 * 本测试锁定三件事：
 * ① 动态产物与 renderMdx 逐字节一致（同一管线，非第二套实现）；
 * ② 动态最终支持的语法清单逐项可用（LaTeX / 表格 / 代码高亮 / 高亮 / Callout / 容器 / 黑幕）；
 * ③ 动态原有特有逻辑（字数上限、标签规则）常量与导出未被破坏。
 */
import { describe, expect, it } from 'vitest';
import { renderMdx, clearRenderCache } from '../src/lib/mdx';
import { renderMomentContent, MAX_CONTENT, MAX_TAGS, MAX_TAG_LEN, serializeTags } from '../src/lib/moments';

/** 覆盖全部语法族的样本（与浏览器三方对比探针使用同一段内容） */
const SAMPLE = `今天的重点：$\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$，==必背结论=={.tip}。

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

| 名称 | 等价式 | 条件 |
| --- | --- | --- |
| $\\sin x$ | $x$ | $x \\to 0$ |

\`\`\`ts
const f = (x: number) => Math.sin(x) / x;
\`\`\`

- [x] 背熟等价无穷小
- [ ] 做课后题

> [!tip] 提醒
> 加减法里替换要谨慎。

:::note
补充说明。
:::

:spoiler[答案：1/3]
`;

describe('动态渲染管线（与文章/文档统一）', () => {
  it('① 动态产物与 renderMdx 完全一致（同一管线、同一后处理）', async () => {
    clearRenderCache();
    const viaMoment = await renderMomentContent(SAMPLE);
    clearRenderCache();
    const viaMdx = (await renderMdx(SAMPLE)).html;
    expect(viaMoment).toBe(viaMdx);
  });

  it('② LaTeX 数学：行内与块级均渲染为 KaTeX，不残留源码', async () => {
    const html = await renderMomentContent('行内 $x^2+y^2=1$ 与块级：\n\n$$\n\\frac{1}{2}\n$$');
    expect(html).toContain('katex');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('$x^2+y^2=1$');
  });

  it('② GFM 表格 + 单元格内公式二次渲染', async () => {
    const html = await renderMomentContent('| a | b |\n| --- | --- |\n| $x$ | $y$ |');
    expect(html).toContain('<table');
    expect(html).toContain('katex');
  });

  it('② 代码块：Prism 高亮 + 行号', async () => {
    const html = await renderMomentContent('```ts\nconst a: number = 1;\n```');
    expect(html).toContain('language-ts');
    expect(html).toMatch(/token|code-line|line-number/);
  });

  it('② 任务列表 / 删除线（GFM）', async () => {
    const html = await renderMomentContent('- [x] 已完成\n- [ ] 待办\n\n~~删除线~~');
    expect(html).toMatch(/checkbox|type="checkbox"/);
    expect(html).toContain('<del>');
  });

  it('② 扩展语法：荧光高亮 / Callout / directive 容器 / 黑幕', async () => {
    const html = await renderMomentContent(
      '==重点=={.tip}\n\n> [!note] 备注\n> 正文\n\n:::note\n提示\n:::\n\n:spoiler[秘密]',
    );
    expect(html).toContain('<mark');
    expect(html).toContain('callout');
    expect(html).toContain('admonition');
    expect(html).toContain('class="spoiler"');
  });

  it('② 折叠面板与选项卡组容器', async () => {
    const html = await renderMomentContent(
      ':::collapse\n- 面板标题\n\n  面板正文\n:::\n\n:::tabs#demo\n\n@tab 甲\n\n内容甲\n\n@tab 乙\n\n内容乙\n\n:::',
    );
    expect(html).toContain('md-collapse');
    expect(html).toContain('tabs');
  });

  it('② 脚注（GFM）：引用与定义共存', async () => {
    const html = await renderMomentContent('正文有脚注[^1]\n\n[^1]: 脚注内容');
    expect(html).toContain('footnote');
  });

  it('② 容错降级：畸形 HTML 不抛错（一条动态不能挂掉整页）', async () => {
    // renderMdx 是 MDX 编译管线，对畸形 HTML 会抛错（实测 `<img src=x onerror=1>`）→
    // renderMomentContent 必须降级到轻量管线并保住其余文本
    const html = await renderMomentContent('<img src=x onerror=alert(1)>\n\n正常文本内容');
    expect(typeof html).toBe('string');
    expect(html).toContain('正常文本内容');
  });

  it('② 常规小于号文本被转义（不误判为 HTML 标签）', async () => {
    const html = await renderMomentContent('误差 <0.5 舍去，且 a < b');
    expect(html).toContain('&lt;0.5');
  });

  it('② 已知边界：原生 HTML 元素按既有管线放行（与文章/文档同一行为，作者可信输入假设）', async () => {
    // 文章页/文档页同管线亦如此（remark-rehype 不放行 raw，但 MDX 把原生标签当 JSX 元素渲染）。
    // 若未来引入净化白名单，本断言需同步更新——它的作用是锁定当前安全边界，防止无声漂移。
    const html = await renderMomentContent('<b>加粗</b> 与 <script>alert(1)</script>');
    expect(html).toContain('<b>');
  });

  it('③ 动态特有逻辑未受影响：上限常量与标签序列化', () => {
    expect(MAX_CONTENT).toBe(2000);
    expect(MAX_TAGS).toBe(10);
    expect(MAX_TAG_LEN).toBe(20);
    // 标签仍是独立数组逻辑（与渲染管线完全解耦）：serializeTags 返回 JSON 字符串
    const tags = JSON.parse(serializeTags([' 高数 ', '高数', '#积分', 'x'.repeat(30)])) as string[];
    expect(tags).toContain('高数');            // trim + 去重
    expect(tags.length).toBeLessThanOrEqual(MAX_TAGS);
    expect(tags.every((t) => t.length <= MAX_TAG_LEN)).toBe(true);
  });
});
