import { describe, expect, it } from 'vitest';
import { extractSnippet, matchArticle, stripMarkdown } from '../src/lib/search';

describe('stripMarkdown', () => {
  it('剥离围栏代码块、行内代码、图片、链接', () => {
    const md = [
      '# 标题',
      '',
      '正文里有 `inline code` 和 [链接文字](https://example.com)。',
      '',
      '```js',
      'const secretKeyword = 1;',
      '```',
      '',
      '![图片说明](https://img.example.com/a.png)',
    ].join('\n');
    const out = stripMarkdown(md);
    expect(out).toContain('标题');
    expect(out).toContain('inline code');
    expect(out).toContain('链接文字');
    expect(out).toContain('图片说明');
    expect(out).not.toContain('https://example.com');
    expect(out).not.toContain('secretKeyword');
  });

  it('剥离标题/引用/列表/强调标记与 HTML 标签', () => {
    const out = stripMarkdown('> 引用\n- 项目 **加粗** _斜体_ ~~删除~~\n<div>标签</div>');
    expect(out).toBe('引用 项目 加粗 斜体 删除 标签');
  });
});

describe('extractSnippet', () => {
  const content = ['第一段普通文字。'.repeat(20), '这里出现了关键词海市蜃楼在正文中。', '结尾文字。'].join('\n');

  it('返回命中处上下文片段（含省略号）', () => {
    const s = extractSnippet(content, '海市蜃楼');
    expect(s).toBeTruthy();
    expect(s).toContain('海市蜃楼');
    expect(s).toMatch(/^…/);
  });

  it('未命中返回 null；空关键词返回 null', () => {
    expect(extractSnippet(content, '不存在的词')).toBeNull();
    expect(extractSnippet(content, '')).toBeNull();
  });

  it('大小写不敏感，且剥离 Markdown 后匹配（命中正文而非链接 URL）', () => {
    const md = '开头介绍。[Composable Architecture](https://example.com/x) 是本文主题。';
    const s = extractSnippet(md, 'composable architecture');
    expect(s).toContain('composable architecture');
    expect(s).not.toContain('https://');
  });
});

describe('matchArticle', () => {
  const a = {
    title: 'Astro 入门',
    summary: '一篇框架介绍',
    tags: ['前端', 'SSR'],
    content: '正文提到 **CodeMirror 6** 的集成方式。',
  };

  it('标题 / 摘要 / 标签 / 正文 任一命中', () => {
    expect(matchArticle(a, 'astro')).toBe(true);
    expect(matchArticle(a, '框架')).toBe(true);
    expect(matchArticle(a, 'SSR')).toBe(true);
    expect(matchArticle(a, 'codemirror')).toBe(true); // 正文（剥离 Markdown 后）
  });

  it('未命中返回 false；空关键词恒 true', () => {
    expect(matchArticle(a, '数据库')).toBe(false);
    expect(matchArticle(a, '')).toBe(true);
  });

  it('代码块内容不参与正文匹配', () => {
    const withCode = { ...a, content: '正文。\n```js\nuniqueTokenInsideCode = 1\n```' };
    expect(matchArticle(withCode, 'uniquetokeninsidecode')).toBe(false);
  });
});
