/**
 * MDX 渲染管线单元测试
 */
import { describe, expect, it } from 'vitest';
import { renderMdx } from '../src/lib/mdx';

describe('renderMdx', () => {
  it('渲染 GFM 表格', async () => {
    const { html } = await renderMdx('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table');
  });

  it('将 :::note 指令转换为 Admonition 组件', async () => {
    const { html } = await renderMdx(':::note\nhello\n:::');
    expect(html).toContain('admonition-note');
    expect(html).toContain('hello');
  });

  it('为代码块添加行号', async () => {
    const { html } = await renderMdx('```ts\nconst a = 1;\n```');
    expect(html).toContain('line-number');
  });

  it('从 h2/h3 提取目录', async () => {
    const { toc } = await renderMdx('## Alpha\n### Beta\n## Gamma');
    expect(toc.map((t) => t.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('将全角反引号（U+FF40）规范化为行内代码', async () => {
    const { html } = await renderMdx('使用 ｀Alt｀ 键切换');
    expect(html).toContain('<code>Alt</code>');
    expect(html).not.toContain('｀');
  });

  it('将修饰符重音符（U+02CB）与反向撇号（U+2035）规范化', async () => {
    const { html } = await renderMdx('a ˋbˋ c ‵d‵');
    expect(html).toContain('<code>b</code>');
    expect(html).toContain('<code>d</code>');
    expect(html).not.toContain('ˋ');
    expect(html).not.toContain('‵');
  });

  it('ASCII 反引号渲染不受影响', async () => {
    const { html } = await renderMdx('使用 `Alt` 键切换');
    expect(html).toContain('<code>Alt</code>');
  });

  it('渲染行内 LaTeX 公式（$...$）', async () => {
    const { html } = await renderMdx('质能方程 $E = mc^2$ 很有名。');
    expect(html).toContain('class="katex"');
    expect(html).toContain('E');
    // 原始 $ 定界符不应残留在输出里
    expect(html).not.toContain('$E = mc^2$');
  });

  it('渲染独立 LaTeX 公式块（$$...$$）', async () => {
    const { html } = await renderMdx('$$\n\\int_0^\\infty e^{-x}\\,dx = 1\n$$');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex"');
  });

  it('代码块内的 $ 不被当作公式定界符', async () => {
    const { html } = await renderMdx('```bash\necho $HOME\n```');
    expect(html).not.toContain('katex');
    expect(html).toContain('$HOME');
  });
});
