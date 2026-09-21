/**
 * doc-render 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * /doc 文档库原本把侧栏、统计、分类书架全内联在 doc.astro 模板里 —— 只能服务端渲染，
 * 于是分类/文档的增删改只能整页刷新，而根容器的 `data-managing`（管理态）与
 * `data-active-cat`（分类筛选）由 SSR 输出复位，reload 就等于「每加一个就退出管理态
 * + 丢掉当前筛选」。抽成同构模块后，客户端改完内存 TREE 就能就地重建。
 *
 * 这里锁住四条契约：
 * 1. 生成的数据属性齐全（客户端委托点击全靠它们定位）；
 * 2. 非管理态下**空分类整个不出现**（与 SSR 一致，游客不该看到空分类）；
 * 3. 管理态才渲染空分类占位与全部管理按钮；
 * 4. 特殊字符被转义、标签开闭配平，不会生成坏标记。
 */
import { describe, it, expect } from 'vitest';
import {
  docCategoryNav,
  docStats,
  docEmptyState,
  docSections,
  docTotals,
} from '../src/lib/doc-render';
import type { DocCategoryRenderable } from '../src/lib/doc-render';

const CATS: DocCategoryRenderable[] = [
  {
    id: 'c1',
    name: '入门指南',
    bundles: [
      { id: 'b1', name: '快速开始', icon: null, summary: null, articleCount: 3, folderCount: 0 },
      { id: 'b2', name: '安装手册', icon: null, summary: '含目录', articleCount: 1, folderCount: 2 },
    ],
  },
  { id: 'c2', name: '空分类', bundles: [] },
];

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

/** 标签开闭配平粗检（本模块产出的都是非自闭合标签） */
function assertBalanced(html: string): void {
  for (const tag of ['div', 'section', 'span', 'button', 'a', 'p', 'h2']) {
    const open = count(html, new RegExp(`<${tag}[\\s>]`, 'g'));
    const close = count(html, new RegExp(`</${tag}>`, 'g'));
    expect(open, `${tag} 标签开闭数应相等`).toBe(close);
  }
}

describe('docCategoryNav', () => {
  const html = docCategoryNav(
    CATS.map((c) => ({ id: c.id, name: c.name, bundleCount: c.bundles.length })),
    2,
  );

  it('「全部」在最前，默认选中，计数为传入的总数', () => {
    expect(html).toContain('data-doc-cat-filter="all"');
    expect(html).toContain('aria-pressed="true"');
    expect(html.indexOf('data-doc-cat-filter="all"')).toBeLessThan(html.indexOf('data-doc-cat-filter="c1"'));
    expect(html).toContain('<span class="filter-category-count">2</span>');
  });

  it('每个分类一个按钮，带名称、计数与未选中态', () => {
    expect(count(html, /class="filter-category"/g)).toBe(2);
    expect(html).toContain('data-doc-cat-filter="c1"');
    expect(html).toContain('data-doc-cat-filter="c2"');
    expect(html).toContain('title="只看「入门指南」"');
    expect(html).toContain('<span class="filter-category-name">空分类</span>');
    expect(html).toContain('<span class="filter-category-count">0</span>');
  });

  it('无分类时只有「全部」', () => {
    const only = docCategoryNav([], 0);
    expect(count(only, /class="filter-category"/g)).toBe(0);
    expect(only).toContain('data-doc-cat-filter="all"');
    assertBalanced(only);
  });

  it('标签配平，且分类名/id 被转义', () => {
    const evil = docCategoryNav([{ id: 'a"b<c', name: '<img src=x onerror=1>', bundleCount: 1 }], 1);
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;img');
    expect(evil).not.toContain('data-doc-cat-filter="a"b<c"');
    expect(evil).toContain('a&quot;b&lt;c');
    assertBalanced(evil);
  });
});

describe('docStats', () => {
  it('输出「N 个分类 · M 册 · K 篇」', () => {
    expect(docStats(3, 12, 48)).toBe('3 个分类 · 12 册 · 48 篇');
    expect(docStats(0, 0, 0)).toBe('0 个分类 · 0 册 · 0 篇');
  });
});

describe('docEmptyState', () => {
  it('管理员可见「＋ 添加分类」', () => {
    const html = docEmptyState(true);
    expect(html).toContain('暂无文档');
    expect(html).toContain('data-doc-cat-add');
    assertBalanced(html);
  });

  it('游客不出现任何管理按钮', () => {
    const html = docEmptyState(false);
    expect(html).toContain('暂无文档');
    expect(html).not.toContain('data-doc-cat-add');
    expect(html).not.toContain('<button');
    assertBalanced(html);
  });
});

describe('docSections —— 非管理态（游客）', () => {
  const html = docSections(CATS, false);

  it('空分类整个不出现（与 SSR 一致）', () => {
    expect(html).not.toContain('data-doc-section="c2"');
    expect(html).not.toContain('空分类');
    expect(html).not.toContain('该分类暂无文档');
  });

  it('有文档的分类正常渲染，卡片带篇数与目录数', () => {
    expect(html).toContain('data-doc-section="c1"');
    expect(html).toContain('href="/doc/b1"');
    expect(html).toContain('href="/doc/b2"');
    expect(html).toContain('3 篇');
    // folderCount > 0 才追加「· N 个目录」
    expect(html).toContain('1 篇 · 2 个目录');
  });

  it('不渲染任何管理按钮', () => {
    expect(html).not.toContain('data-doc-cat-add');
    expect(html).not.toContain('data-doc-cat-edit');
    expect(html).not.toContain('data-doc-cat-del');
    expect(html).not.toContain('data-doc-bundle-add');
    expect(html).not.toContain('data-doc-bundle-edit');
    expect(html).not.toContain('data-doc-bundle-del');
    expect(html).not.toContain('doc-manage-only');
  });

  it('标签配平', () => {
    assertBalanced(html);
  });
});

describe('docSections —— 管理态（已登录）', () => {
  const html = docSections(CATS, true);

  it('顶部有「＋ 添加分类」', () => {
    expect(html).toContain('data-doc-cat-add');
  });

  it('空分类保留占位与「＋ 添加文档」', () => {
    expect(html).toContain('data-doc-section="c2"');
    expect(html).toContain('该分类暂无文档');
    expect(html).toContain('doc-cat-empty');
    expect(html).toContain('data-doc-bundle-add="c2"');
  });

  it('分类与文档都带编辑/删除按钮', () => {
    expect(html).toContain('data-doc-cat-edit="c1"');
    expect(html).toContain('data-doc-cat-del="c1"');
    expect(html).toContain('data-doc-bundle-edit="b1"');
    expect(html).toContain('data-doc-bundle-del="b1"');
    expect(html).toContain('data-doc-bundle-add="c1"');
  });

  it('删除按钮带 data-doc-name（确认弹窗用）', () => {
    expect(html).toContain('data-doc-name="入门指南"');
    expect(html).toContain('data-doc-name="快速开始"');
  });

  it('标签配平', () => {
    assertBalanced(html);
  });

  it('分类名与文档名被转义', () => {
    const evil = docSections(
      [
        {
          id: 'x"><script>',
          name: '<b>粗</b>',
          bundles: [{ id: 'y" onmouseover="1', name: '<i>x</i>', icon: null, summary: null, articleCount: 1, folderCount: 0 }],
        },
      ],
      true,
    );
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<b>粗</b>');
    expect(evil).not.toContain('<i>x</i>');
    expect(evil).toContain('&lt;b&gt;粗&lt;/b&gt;');
    assertBalanced(evil);
  });
});

describe('docTotals', () => {
  it('汇总分类数、册数与总篇数', () => {
    expect(docTotals(CATS)).toEqual({ catCount: 2, bundleCount: 2, articleCount: 4 });
  });

  it('空输入返回全 0', () => {
    expect(docTotals([])).toEqual({ catCount: 0, bundleCount: 0, articleCount: 0 });
  });

  it('articleCount 缺失时按 0 计，不产生 NaN', () => {
    const got = docTotals([
      {
        id: 'c',
        name: 'c',
        bundles: [
          { id: 'b', name: 'b', icon: null, summary: null, articleCount: undefined as unknown as number, folderCount: 0 },
        ],
      },
    ]);
    expect(got.articleCount).toBe(0);
  });
});
