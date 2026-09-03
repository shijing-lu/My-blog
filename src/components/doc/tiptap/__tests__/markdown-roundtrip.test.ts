/**
 * markdown-roundtrip.test.ts —— 文档编辑 markdown ⇄ 文档树 保真矩阵（P1）
 *
 * 核心不变式：DocTiptapEditor 任何编辑产物必须仍是 renderMdx 可接受的 markdown。
 * 由于 MarkdownManager 的 parse/serialize 不依赖 DOM（纯 JSONContent），本测试
 * 可在 node 环境运行（与项目 vitest 配置一致），无需 jsdom。
 *
 * 断言分层：
 * 1. 结构幂等：parse → serialize → 再 parse，第二次与第一次 JSON 一致
 *    （一阶 round-trip 允许语义等价差异，见 normalize；二阶必须稳定）。
 * 2. 渲染安全：serialize 产物交给 renderMdx 不抛错、无 katex-error。
 * 3. 语义保留：关键语法（公式 latex、:::note、表格、代码围栏）不出现在
 *    错误位置 / 不丢失。
 *
 * 已知差异白名单（等价差异，见 normalize）：
 * - 同行 `$$x$$` → 独立 fence `$$\nx\n$$`（与服务端 normalizeMathFences 行为一致）
 * - 表格单元格对齐 padding（| a | b | → | a  | b    |）语义等价
 */
import { describe, expect, it } from 'vitest';
import { MarkdownManager } from '@tiptap/markdown';
import { buildDocExtensions } from '../extensions';
import { renderMdx } from '@/lib/mdx';

/** 构造 MarkdownManager（无 DOM，node 可用） */
function makeManager(): MarkdownManager {
  return new MarkdownManager({ extensions: buildDocExtensions() });
}

/** 语义等价归一化（吸收白名单差异后比较用） */
function normalize(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    // 表格单元格 padding：| a | b | 与 | a  | b    | 等价
    .replace(/\|\s+/g, '|')
    .replace(/\s+\|/g, '|')
    .replace(/\s*$/, '');
}

/** parse → serialize（一阶）；再做一次（二阶） */
function roundTrip(md: string): { first: string; second: string; json1: unknown; json2: unknown } {
  const mgr = makeManager();
  const json1 = mgr.parse(md);
  const first = mgr.serialize(json1 as never);
  const json2 = mgr.parse(first);
  const second = mgr.serialize(json2 as never);
  return { first, second, json1, json2 };
}

/** 校验「渲染安全」：serialize 产物 renderMdx 不抛错且无 katex-error */
async function expectRenderSafe(md: string): Promise<void> {
  const { html } = await renderMdx(md);
  expect(html).not.toContain('katex-error');
}

describe('doc 编辑 markdown round-trip 保真', () => {
  it('标题/粗斜/行内码/链接', () => {
    const src = '# H1\n\n## H2\n\n这是 **粗体** 与 *斜体* 与 `code` 与 [链接](https://a.b) 与 ~~删~~。';
    const { first, second } = roundTrip(src);
    expect(normalize(first)).toBe(normalize(src));
    expect(second).toBe(first); // 二阶稳定
  });

  it('行内与块级公式（latex 源码保留）', () => {
    const src = '质能 $E = mc^2$ 公式。\n\n$$\nx^2 + y^2 = z^2\n$$';
    const { first, json1 } = roundTrip(src);
    expect(first).toContain('E = mc^2');
    expect(first).toContain('x^2 + y^2 = z^2');
    // 解析后必须有 inlineMath / blockMath 节点（而非普通文本）
    const s = JSON.stringify(json1);
    expect(s).toContain('inlineMath');
    expect(s).toContain('blockMath');
  });

  it('同行 $$ 块级公式被规范化为独立 fence（白名单差异）', () => {
    const src = '$$a^2 = b^2$$';
    const { first } = roundTrip(src);
    expect(first).toBe('$$\na^2 = b^2\n$$');
    const { first: f2 } = roundTrip(first);
    expect(f2).toBe(first); // 规范化后幂等
  });

  it('嵌套列表 / 任务列表', () => {
    const src = '- 甲\n- 乙\n  - 乙一\n\n1. 一\n2. 二\n\n- [ ] 待办\n- [x] 完成';
    const { first } = roundTrip(src);
    expect(normalize(first)).toBe(normalize(src));
  });

  it('GFM 表格（含行内粗体与公式 cell）', () => {
    const src = '| 列A | 列B |\n| --- | --- |\n| 1 | **粗** |\n| $x$ | $\\int_0^1$ |';
    const { first, json1 } = roundTrip(src);
    expect(first).toContain('列A');
    expect(first).toContain('**粗**');
    // 公式 cell 应解析为 inlineMath（见结构断言）
    expect(JSON.stringify(json1)).toContain('inlineMath');
    expect(JSON.stringify(json1)).toContain('\\int_0^1');
  });

  it('代码围栏含 $ / ::: 字面内容不误伤', () => {
    const src = '```md\n$$not math$$\n:::not admonition:::\n```';
    const { first, json1 } = roundTrip(src);
    expect(first).toContain('$$not math$$');
    const s = JSON.stringify(json1);
    // 围栏内内容应整体在 codeBlock 文本里，不产生 blockMath/admonition 节点
    expect(s).toContain('"type":"codeBlock"');
    expect(s).toContain(':::not admonition:::');
    expect(s).not.toContain('blockMath');
    expect(s).not.toContain('"type":"admonition"');
  });

  it(':::note 容器指令（五类）→ admonition 节点', () => {
    const src = ':::note\n这是 **笔记** 内容\n\n- 项一\n:::\n\n:::warning\n警告\n:::';
    const { first, json1 } = roundTrip(src);
    const s = JSON.stringify(json1);
    expect(s).toContain('"type":"admonition"');
    expect(s).toContain('"note"');
    expect(s).toContain('"warning"');
    expect(first).toContain(':::note');
    expect(first).toContain(':::warning');
    expect(first).toContain('**笔记**');
  });

  it('幂等：一阶 serialize 后二阶不再漂移', () => {
    const srcs = [
      '# 甲\n\n段落一 **粗** $a$。\n\n:::tip\n提示\n:::\n\n| a | b |\n| - | - |\n| 1 | 2 |',
      '- 一\n  - 子\n- [ ] 待办\n\n```ts\nconst x = 1\n```',
    ];
    for (const src of srcs) {
      const { first, second } = roundTrip(src);
      expect(second).toBe(first);
    }
  });

  it('渲染安全：代表性语料 serialize 产物 renderMdx 不抛错', async () => {
    const srcs = [
      '# 标题\n\n质能方程 $E = mc^2$ 公式。\n\n$$\n\\int_0^\\infty e^{-x}\\,dx = 1\n$$',
      ':::note\n这是 **笔记**\n:::\n\n| a | b |\n| - | - |\n| $x$ | 2 |',
      '- [ ] 任务\n\n```ts\nlet a = 1\n```',
    ];
    for (const src of srcs) {
      const { first } = roundTrip(src);
      await expectRenderSafe(first);
    }
  });
});
