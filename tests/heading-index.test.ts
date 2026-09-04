/**
 * heading-index 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * 覆盖目录点击跳转的定位基础：Lezer 语法树枚举标题、代码块内 `#` 不误判、
 * setext 标题、同 level 第 N 个对齐（重名/数学标题免疫）。
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { scanHeadings, nthHeading, normHeadingText } from '../src/lib/heading-index';

/** 构造一个带 markdown 语法树的编辑器状态 */
function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
}

describe('scanHeadings', () => {
  it('识别各级 ATX 标题并去掉 # 标记', () => {
    const hits = scanHeadings(stateOf('# 一级\n正文\n#### 四级\n'));
    expect(hits.map((h) => [h.level, h.text])).toEqual([
      [1, '一级'],
      [4, '四级'],
    ]);
  });

  it('代码块内的 # 行不算标题（语法树天然排除）', () => {
    const doc = '## 真标题\n\n```bash\n# 这是 shell 注释，不是标题\n# 又一行\n```\n\n### 另一个\n';
    const hits = scanHeadings(stateOf(doc));
    expect(hits.map((h) => h.text)).toEqual(['真标题', '另一个']);
    expect(hits.every((h) => !h.text.includes('shell'))).toBe(true);
  });

  it('行内代码里的 # 也不算标题', () => {
    const hits = scanHeadings(stateOf('## 标题\n\n正文里提到 `#tag` 与 # 号。\n'));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe('标题');
  });

  it('识别 setext 下划线式标题', () => {
    const hits = scanHeadings(stateOf('一级标题\n=====\n\n二级标题\n-----\n'));
    expect(hits.map((h) => [h.level, h.text])).toEqual([
      [1, '一级标题'],
      [2, '二级标题'],
    ]);
  });

  it('保留重名标题的重复项（供序列对齐）', () => {
    const hits = scanHeadings(stateOf('## 概述\n\n## 概述\n\n## 概述\n'));
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.pos)).not.toEqual([0, 0, 0]);
  });
});

describe('nthHeading', () => {
  const doc = [
    '# 文档标题',
    '',
    '## A 概述',
    '',
    '### 细节一',
    '',
    '## B 实现',
    '',
    '```ts',
    '## 代码块里的假标题',
    '```',
    '',
    '### 细节二',
    '',
    '## A 概述',
  ].join('\n');
  const st = stateOf(doc);

  it('同 level 第 N 个按文档顺序对齐（跳过代码块内的假标题）', () => {
    expect(nthHeading(st, 2, 0)?.text).toBe('A 概述');
    expect(nthHeading(st, 2, 1)?.text).toBe('B 实现');
    expect(nthHeading(st, 2, 2)?.text).toBe('A 概述');
    expect(nthHeading(st, 3, 0)?.text).toBe('细节一');
    expect(nthHeading(st, 3, 1)?.text).toBe('细节二');
  });

  it('越界返回 null', () => {
    expect(nthHeading(st, 2, 3)).toBeNull();
    expect(nthHeading(st, 5, 0)).toBeNull();
  });

  it('数学/特殊字符标题不影响定位（文本可校验）', () => {
    const s2 = stateOf('## $E=mc^2$ 推导\n\n## 中文标题\n\n## 中文标题\n');
    expect(nthHeading(s2, 2, 0)?.text).toBe('$E=mc^2$ 推导');
    expect(nthHeading(s2, 2, 2)?.text).toBe('中文标题');
  });

  it('pos 可换算回正确行号', () => {
    const hit = nthHeading(st, 3, 1);
    expect(hit).not.toBeNull();
    expect(st.doc.lineAt(hit!.pos).number).toBe(13);
  });
});

describe('normHeadingText', () => {
  it('折叠空白、去数学与强调记号、小写', () => {
    expect(normHeadingText('  $E  =  mc^2$ ')).toBe('e = mc^2');
    expect(normHeadingText('**粗体** 与 `代码`')).toBe('粗体 与 代码');
    expect(normHeadingText('ABC')).toBe('abc');
  });
});

describe('真实文章 fixture：服务端 toc 与源码序列对齐', () => {
  // 曾作为种子数据插入 sqlite 并经服务端 render 管线产出 toc 验证通过；
  // 固化为内联 fixture 以便永久回归（不依赖数据库/dev 服务器）。
  const para = (n: number): string =>
    Array.from(
      { length: 6 },
      (_, i) => `这是第 ${n} 段的填充文字第 ${i + 1} 行，用于把文章撑到超过一屏高度以便测试编辑器内部滚动。`,
    ).join('\n\n');
  const doc = [
    '# 目录跳转测试长文',
    '',
    '## 第一章 概述',
    '',
    para(1),
    '',
    '### 1.1 背景',
    '',
    para(2),
    '',
    '```bash',
    '# 这是代码块里的注释，不是标题',
    'echo hello',
    '```',
    '',
    '### 1.2 目标',
    '',
    para(3),
    '',
    '## 第二章 实现',
    '',
    para(4),
    '',
    '### 2.1 语法树扫描',
    '',
    para(5),
    '',
    '### 2.2 序列对齐',
    '',
    para(6),
    '',
    '## 概述',
    '',
    para(7),
    '',
    '### 小结',
    '',
    para(8),
  ].join('\n');
  // 服务端 render API 实际产出的 toc（extractToc，h2–h4）
  const toc: Array<{ level: number; text: string }> = [
    { level: 2, text: '第一章 概述' },
    { level: 3, text: '1.1 背景' },
    { level: 3, text: '1.2 目标' },
    { level: 2, text: '第二章 实现' },
    { level: 3, text: '2.1 语法树扫描' },
    { level: 3, text: '2.2 序列对齐' },
    { level: 2, text: '概述' },
    { level: 3, text: '小结' },
  ];
  const st = stateOf(doc);

  it('目录每一项都能按「同 level 第 N 个」命中同一标题（含重名"概述"）', () => {
    const seen = new Map<number, number>();
    for (const item of toc) {
      const nth = seen.get(item.level) ?? 0;
      seen.set(item.level, nth + 1);
      const hit = nthHeading(st, item.level, nth);
      expect(hit, `level=${item.level} nth=${nth} (${item.text})`).not.toBeNull();
      expect(normHeadingText(hit!.text)).toBe(normHeadingText(item.text));
    }
  });

  it('h2–h4 标题数与目录项数一致；H1 是文章标题不参与目录', () => {
    const all = scanHeadings(st);
    expect(all.filter((h) => h.level >= 2 && h.level <= 4)).toHaveLength(toc.length);
    expect(all.filter((h) => h.level === 1)).toHaveLength(1);
  });
});
