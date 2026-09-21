/**
 * admin-nav-render 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * 这是后台「导航管理」页「服务端 SSR + 客户端就地重渲染」共用的标记生成模块：
 * admin/nav.astro 首屏用 adminCatList/adminSiteGroups/adminCatOptions 渲染，
 * 增删改成功后客户端用同一套函数重建 —— 因此不再整页刷新、不再丢滚动位置。
 * 这里锁住三条契约：
 * 1. 生成的选择器/数据属性齐全（客户端委托点击、移动下拉全靠它们定位）；
 * 2. 空数据、特殊字符等边界不会生成坏标记；
 * 3. `insertOrdered` 的插入位置与服务端 `ORDER BY sort, createdAt` 等价。
 */
import { describe, it, expect } from 'vitest';
import {
  adminCatList,
  adminCatOptions,
  adminSiteGroups,
  insertOrdered,
  removeById,
} from '../src/lib/admin-nav-render';
import type { AdminCategoryRenderable } from '../src/lib/admin-nav-render';

const CATS: AdminCategoryRenderable[] = [
  {
    id: 'c1',
    name: 'AI 工具',
    icon: '🤖',
    sort: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    sites: [
      { id: 's1', name: 'ChatGPT', url: 'https://chat.openai.com', sort: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 's2', name: 'Claude', url: 'https://claude.ai', sort: 0, createdAt: '2026-01-02T00:00:00.000Z' },
    ],
  },
  { id: 'c2', name: '设计', icon: null, sort: 1, createdAt: '2026-01-03T00:00:00.000Z', sites: [] },
];

/** 统计标签出现次数（用于粗检开闭配平） */
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe('adminCatList', () => {
  const html = adminCatList(CATS);

  it('每个分类一行，带编辑/删除按钮与网站数', () => {
    expect(count(html, /<li/g)).toBe(2);
    expect(html).toContain('data-cat-edit="c1"');
    expect(html).toContain('data-cat-del="c1"');
    expect(html).toContain('data-cat-name="AI 工具"');
    expect(html).toContain('2 站');
    expect(html).toContain('0 站');
  });

  it('有图标才渲染图标节点', () => {
    expect(html).toContain('🤖');
    expect(count(html, /class="shrink-0 text-sm"/g)).toBe(1);
  });

  it('空列表返回空串', () => {
    expect(adminCatList([])).toBe('');
  });

  it('li 开闭配平', () => {
    expect(count(html, /<li/g)).toBe(count(html, /<\/li>/g));
  });
});

describe('adminSiteGroups', () => {
  const html = adminSiteGroups(CATS);

  it('按分类分组，每组一个标题', () => {
    expect(count(html, /<h3/g)).toBe(2);
    expect(html).toContain('AI 工具');
    expect(html).toContain('设计');
  });

  it('空分类给出「暂无网站」占位', () => {
    expect(html).toContain('暂无网站');
  });

  it('网站行带移动下拉 + 编辑/删除按钮', () => {
    expect(html).toContain('data-site-move="s1"');
    expect(html).toContain('data-site-edit="s1"');
    expect(html).toContain('data-site-del="s1"');
    expect(html).toContain('data-site-name="ChatGPT"');
  });

  it('移动下拉列出全部分类，且预选中当前所属分类', () => {
    // s1 属于 c1：c1 的 option 带 selected，c2 的不带
    const s1 = html.slice(html.indexOf('data-site-move="s1"'));
    const select = s1.slice(0, s1.indexOf('</select>'));
    expect(select).toContain('<option value="c1" selected>AI 工具</option>');
    expect(select).toContain('<option value="c2">设计</option>');
  });

  it('div / ul / li / h3 / select 开闭配平', () => {
    expect(count(html, /<div/g)).toBe(count(html, /<\/div>/g));
    expect(count(html, /<ul/g)).toBe(count(html, /<\/ul>/g));
    expect(count(html, /<li/g)).toBe(count(html, /<\/li>/g));
    expect(count(html, /<h3/g)).toBe(count(html, /<\/h3>/g));
    expect(count(html, /<select/g)).toBe(count(html, /<\/select>/g));
  });
});

describe('adminCatOptions', () => {
  it('每个分类一个 option', () => {
    const html = adminCatOptions(CATS);
    expect(html).toBe('<option value="c1">AI 工具</option><option value="c2">设计</option>');
  });

  it('空列表返回空串', () => {
    expect(adminCatOptions([])).toBe('');
  });
});

describe('转义', () => {
  it('分类名/网站名里的引号与尖括号不会破坏属性', () => {
    const html = adminCatList([
      {
        id: 'x"y',
        name: 'a"b<c>',
        icon: null,
        sort: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        sites: [],
      },
    ]);
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;c&gt;');
    expect(html).not.toContain('a"b');
    expect(html).toContain('data-cat-name="a&quot;b&lt;c&gt;"');
  });
});

describe('insertOrdered（与服务端 ORDER BY sort, createdAt 等价）', () => {
  type Item = { id: string; sort: number; createdAt: string | Date };
  const ids = (list: Item[]): string[] => list.map((x) => x.id);

  it('sort 大的排后面', () => {
    const list: Item[] = [
      { id: 'a', sort: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', sort: 5, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    insertOrdered(list, { id: 'n', sort: 3, createdAt: '2026-02-01T00:00:00.000Z' });
    expect(ids(list)).toEqual(['a', 'n', 'b']);
  });

  it('sort 最小的插到最前', () => {
    const list: Item[] = [
      { id: 'a', sort: 5, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', sort: 10, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    insertOrdered(list, { id: 'n', sort: 0, createdAt: '2026-02-01T00:00:00.000Z' });
    expect(ids(list)).toEqual(['n', 'a', 'b']);
  });

  it('sort 相同时按 createdAt 升序 —— 新建记录（createdAt 最大）排末尾', () => {
    const list: Item[] = [
      { id: 'a', sort: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', sort: 0, createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    insertOrdered(list, { id: 'new', sort: 0, createdAt: '2026-03-01T00:00:00.000Z' });
    expect(ids(list)).toEqual(['a', 'b', 'new']);
  });

  it('sort 相同时 createdAt 较早的插到前面', () => {
    const list: Item[] = [
      { id: 'a', sort: 0, createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'b', sort: 0, createdAt: '2026-01-06T00:00:00.000Z' },
    ];
    insertOrdered(list, { id: 'old', sort: 0, createdAt: '2026-01-04T00:00:00.000Z' });
    expect(ids(list)).toEqual(['old', 'a', 'b']);
  });

  it('Date 与 ISO 字符串等价（服务端传 Date、客户端传字符串）', () => {
    const list: Item[] = [
      { id: 'a', sort: 0, createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'b', sort: 0, createdAt: '2026-01-06T00:00:00.000Z' },
    ];
    insertOrdered(list, { id: 'd', sort: 0, createdAt: new Date('2026-01-04T00:00:00.000Z') });
    expect(ids(list)).toEqual(['d', 'a', 'b']);
  });

  it('空列表直接放入', () => {
    const list: Item[] = [];
    insertOrdered(list, { id: 'only', sort: 0, createdAt: '2026-01-01T00:00:00.000Z' });
    expect(ids(list)).toEqual(['only']);
  });

  it('插入不打乱既有元素的相对顺序', () => {
    const list: Item[] = [
      { id: 'a', sort: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', sort: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c', sort: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    insertOrdered(list, { id: 'n', sort: 1, createdAt: '2026-01-02T00:00:00.000Z' });
    expect(ids(list)).toEqual(['a', 'b', 'n', 'c']);
  });
});

describe('removeById', () => {
  it('移除并返回命中项', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(removeById(list, 'b')).toEqual({ id: 'b' });
    expect(list.map((x) => x.id)).toEqual(['a']);
  });

  it('不存在时返回 undefined 且不改动数组', () => {
    const list = [{ id: 'a' }];
    expect(removeById(list, 'zzz')).toBeUndefined();
    expect(list).toHaveLength(1);
  });
});
