/**
 * MDX 渲染管线单元测试
 */
import { describe, expect, it } from 'vitest';
import { renderMdx, renderMarkdownHtml } from '../src/lib/mdx';
import { buildTocTree, renderTocTreeHtml } from '../src/lib/toc-tree';

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

describe('目录：层级、KaTeX 与树形渲染', () => {
  it('从 h2/h3/h4 提取目录（h4 亦采集）', async () => {
    const { toc } = await renderMdx('## A\n### B\n#### C\n## D');
    expect(toc.map((t) => t.level)).toEqual([2, 3, 4, 2]);
    expect(toc.map((t) => t.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('标题含 LaTeX 时 html 字段带 KaTeX 标记、text 为 LaTeX 源码', async () => {
    const { toc } = await renderMdx('## 范德蒙行列式 $V_n$ 的性质\n### 展开 $D_n = \\prod$');
    expect(toc).toHaveLength(2);
    expect(toc[0]!.html).toContain('class="katex"');
    expect(toc[0]!.text).toContain('V_n');
    expect(toc[0]!.text).not.toContain('$'); // $ 定界符不残留
    expect(toc[1]!.html).toContain('class="katex"');
  });

  it('纯文本标题 html 字段为普通标记（无 katex）', async () => {
    const { toc } = await renderMdx('## 普通标题');
    expect(toc[0]!.html).toContain('普通标题');
    expect(toc[0]!.html).not.toContain('katex');
  });

  it('buildTocTree：扁平 → 嵌套树（跳级挂最近浅级）', () => {
    const tree = buildTocTree([
      { id: 'a', text: 'A', level: 2 },
      { id: 'b', text: 'B', level: 3 },
      { id: 'c', text: 'C', level: 4 },
      { id: 'd', text: 'D', level: 2 },
    ]);
    expect(tree.map((n) => n.item.id)).toEqual(['a', 'd']);
    expect(tree[0]!.children.map((n) => n.item.id)).toEqual(['b']);
    expect(tree[0]!.children[0]!.children.map((n) => n.item.id)).toEqual(['c']);
    expect(tree[1]!.children).toHaveLength(0);
  });

  it('renderTocTreeHtml：有子级才有折叠按钮，层级类名正确', () => {
    const out = renderTocTreeHtml([
      { id: 'a', text: 'A', level: 2 },
      { id: 'b', text: 'B', level: 3 },
      { id: 'd', text: 'D', level: 2 },
    ]);
    expect(out).toContain('toc-node');
    expect(out).toContain('data-doc-anchor');
    expect(out).toContain('toc-l2');
    expect(out).toContain('toc-l3');
    // A 节点带折叠按钮；叶子 B/D 用占位符
    expect((out.match(/class="toc-fold"/g) ?? []).length).toBe(1);
    expect(out).toContain('toc-fold-spacer');
    expect(out).toContain('href="#a"');
    expect(out).toContain('href="#b"');
  });

  it('renderTocTreeHtml：KaTeX html 字段注入，纯文本转义', () => {
    const out = renderTocTreeHtml([
      { id: 'a', text: 'A <对比>', level: 2, html: '<span class="katex">x</span>' },
      { id: 'b', text: 'B <对比>', level: 2 },
    ]);
    expect(out).toContain('<span class="katex">x</span>'); // html 原样注入
    expect(out).toContain('B &lt;对比&gt;'); // text 转义
    expect(out).not.toContain('>B <对比><'); // 未转义原文不出现
  });
});

/**
 * renderMarkdownHtml —— 动态（moments）正文渲染的同一轻量 GFM 管线。
 * 与列表 / load-more / 预览共用此实现，故此处锁定其契约：
 * GFM 语法生效、原始 HTML 不注入（XSS 安全）、空串输出空 HTML。
 */
describe('renderMarkdownHtml', () => {
  it('渲染粗体与行内代码', async () => {
    const html = await renderMarkdownHtml('**你好** 与 `code`');
    expect(html).toContain('<strong>你好</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('渲染列表与链接', async () => {
    const html = await renderMarkdownHtml('- 第一项\n- 第二项\n\n[官网](https://example.com)');
    expect(html).toContain('<li>第一项</li>');
    expect(html).toContain('href="https://example.com"');
  });

  it('渲染 GFM 表格', async () => {
    const html = await renderMarkdownHtml('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
  });

  it('原始 HTML 不注入（标签被剥离，只保留纯文本）', async () => {
    // 无 rehype-raw：脚本块被整体丢弃 → 绝不输出可执行脚本
    const script = await renderMarkdownHtml('<script>alert(1)</script>');
    expect(script).not.toContain('<script>');
    expect(script).not.toContain('alert(1)');
    // 行内 HTML 标签同样被剥离，仅保留文本，事件属性不会外泄
    const inline = await renderMarkdownHtml('a <b onclick="x">bold</b> c');
    expect(inline).not.toContain('<b');
    expect(inline).not.toContain('onclick');
    expect(inline).toContain('bold');
  });

  it('空内容输出空（或空白）', async () => {
    expect(await renderMarkdownHtml('')).toBe('');
    expect((await renderMarkdownHtml('   ')).trim()).toBe('');
  });
});
