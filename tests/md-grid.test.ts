/**
 * `:::grid` 图片画廊网格 · 渲染管线回归测试
 *
 * 覆盖：最简语法、参数生效与回退、图注优先级、独立灯箱分组、
 * 容器外图片不受影响、以及各类降级场景（不崩、不残留标记）。
 */
import { describe, expect, it } from 'vitest';
import { renderMdx, normalizeSource } from '../src/lib/mdx';

/** 构造一个最简网格 */
const grid = (body: string, params = ''): string => `:::grid${params}\n\n${body}\n\n:::`;

describe(':::grid 参数规范化（源码层）', () => {
  it('把带引号的花括号参数编码为 {#token}', () => {
    const out = normalizeSource(':::grid{columns="3" aspect="16/9" fit="cover"}');
    expect(out).toContain(':::grid{#g3-a16x9-cover}');
  });

  it('支持空格分隔的参数写法', () => {
    const out = normalizeSource(':::grid columns=2 aspect=1/1 fit=contain');
    expect(out).toContain(':::grid{#g2-a1x1-contain}');
  });

  it('无参数时使用默认值（3 列 / 16:10 / cover）', () => {
    const out = normalizeSource(':::grid');
    expect(out).toContain(':::grid{#g3-a16x10-cover}');
  });

  it('非法值逐项回退默认', () => {
    const out = normalizeSource(':::grid{columns="9" aspect="abc" fit="fill"}');
    expect(out).toContain(':::grid{#g3-a16x10-cover}');
  });

  it('冒号比例写法等价于斜杠写法', () => {
    const out = normalizeSource(':::grid{aspect="3:4"}');
    expect(out).toContain('a3x4');
  });

  it('围栏代码块内的示例写法原样保留', () => {
    const src = '```markdown\n:::grid{columns="2"}\n```';
    expect(normalizeSource(src)).toContain(':::grid{columns="2"}');
  });

  it('行尾混入无法解释的内容时原样保留（降级，不吞内容）', () => {
    const src = ':::grid 这是一段正文说明';
    expect(normalizeSource(src)).toContain(':::grid 这是一段正文说明');
  });
});

describe(':::grid 渲染结果', () => {
  it('最简语法渲染出网格容器与图片', async () => {
    const { html } = await renderMdx(grid('![图一](/img/a.webp)\n\n![图二](/img/b.webp)'));
    expect(html).toContain('md-grid');
    expect(html).toContain('/img/a.webp');
    expect(html).toContain('/img/b.webp');
  });

  it('列数、比例、适应模式注入为 CSS 变量', async () => {
    const { html } = await renderMdx(grid('![图一](/img/a.webp)', '{columns="4" aspect="1/1" fit="contain"}'));
    expect(html).toContain('--md-grid-cols:4');
    expect(html).toContain('--md-grid-aspect:1/1');
    expect(html).toContain('--md-grid-fit:contain');
  });

  it('非法参数渲染时依旧回退默认值', async () => {
    const { html } = await renderMdx(grid('![图一](/img/a.webp)', '{columns="99" fit="stretch"}'));
    expect(html).toContain('--md-grid-cols:3');
    expect(html).toContain('--md-grid-fit:cover');
  });

  it('图注优先取 title，其次 alt', async () => {
    const { html } = await renderMdx(
      grid('![替代文本](/img/a.webp "标题图注")\n\n![只有替代文本](/img/b.webp)'),
    );
    expect(html).toContain('标题图注');
    expect(html).toContain('只有替代文本');
  });

  it('同文档两个网格渲染为两个独立容器（灯箱据此分组）', async () => {
    const src = `${grid('![图一](/img/a.webp)')}\n\n${grid('![图二](/img/b.webp)')}`;
    const { html } = await renderMdx(src);
    // 分组由脚本按「最近的 .md-grid 祖先」判定，渲染层只需保证容器独立
    expect((html.match(/class="md-grid"/g) ?? []).length).toBe(2);
  });

  it('容器外的普通图片不被网格包裹（行为不变）', async () => {
    const { html } = await renderMdx('![正文图片](/img/plain.webp)');
    expect(html).toContain('data-lightbox');
    expect(html).not.toContain('md-grid');
  });

  it('未闭合容器降级为普通内容且不残留哨兵', async () => {
    const { html } = await renderMdx(':::grid\n\n![图一](/img/a.webp)');
    expect(html).toContain('/img/a.webp');
    expect(html).not.toContain('\uE000');
    expect(html).not.toContain('{#');
  });

  it('单图网格正常渲染', async () => {
    const { html } = await renderMdx(grid('![独图](/img/only.webp)', '{columns="1"}'));
    expect(html).toContain('--md-grid-cols:1');
    expect(html).toContain('/img/only.webp');
  });
});
