import { describe, expect, it } from 'vitest';
import { buildMarkdownColumns, removeMarkdownColumn, scanMarkdownColumns } from '../src/lib/markdown-columns';
import { renderMdx } from '../src/lib/mdx';

describe('Markdown columns', () => {
  it('round trips blank columns and multiline Markdown without changing inner content', () => {
    const contents = ['## 标题\n\n- 项目\n  - 子项目\n\n    indented code\n\n', '', '**第三栏**'];
    const source = buildMarkdownColumns(contents);
    const [block] = scanMarkdownColumns(source);
    expect(block?.columns.map((column) => column.content)).toEqual(contents);
    expect(block?.to).toBe(source.length);
  });

  it('ignores column markers in code and nested directives and lengthens the outer fence', () => {
    const contents = ['```md\n::column\n:::note\nexample\n:::\n```', ':::note\n::column\ntext\n:::'];
    const source = buildMarkdownColumns(contents);
    expect(source.startsWith('::::columns')).toBe(true);
    expect(scanMarkdownColumns(source)[0]?.columns.map((column) => column.content)).toEqual(contents);
    expect(scanMarkdownColumns('```md\n' + source + '\n```')).toEqual([]);
  });

  it('rejects unfinished or malformed structures without guessing away content', () => {
    expect(scanMarkdownColumns(':::columns\n::column\na\n::column\nb')).toEqual([]);
    expect(scanMarkdownColumns(':::columns\nunassigned\n::column\na\n::column\nb\n:::')).toEqual([]);
    expect(scanMarkdownColumns(':::columns\n::column\na\n:::')).toEqual([]);
  });

  it('merges a removed populated column in reading order', () => {
    expect(removeMarkdownColumn(['a', 'b', 'c'], 0)).toEqual(['a\n\nb', 'c']);
    expect(removeMarkdownColumn(['a', 'b', 'c'], 1)).toEqual(['a\n\nb', 'c']);
    expect(removeMarkdownColumn(['a', 'b', 'c'], 2)).toEqual(['a', 'b\n\nc']);
  });

  it('renders complete Markdown subtrees, math, tables and headings through the real pipeline', async () => {
    const source = buildMarkdownColumns(['## 第一栏\n\n**加粗**\n\n- 一\n- 二', '## 第二栏\n\n$x^2$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |']);
    const { html, toc } = await renderMdx(source);
    expect(html).toContain('data-columns="2"');
    expect(html.match(/class="md-column"/g)).toHaveLength(2);
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<table');
    expect(html).toContain('katex');
    expect(toc.map((item) => item.text)).toEqual(expect.arrayContaining(['第一栏', '第二栏']));
  });

  it('keeps invalid column content and markers visible instead of silently deleting them', async () => {
    const { html } = await renderMdx(':::columns\n::column\n保留这段\n:::');
    expect(html).toContain('保留这段');
    expect(html).toContain('::column');
    expect(html).not.toContain('class="md-columns"');
  });
});
