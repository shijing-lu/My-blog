/**
 * nav-render 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * nav-render 是导航页「服务端 SSR + 客户端就地重渲染」共用的标记生成模块：
 * nav.astro 首屏用 navTopTabs/navMain 渲染，管理端增删改后客户端用同一对函数重建，
 * 从而不再整页刷新、不再跳回「全部网站」。这里锁住两条契约：
 * 1. 生成的选择器/数据属性齐全（客户端 activate / 拖拽 / 弹窗全靠它们定位）；
 * 2. 空数据、游客态、特殊字符等边界不会生成坏标记。
 */
import { describe, it, expect } from 'vitest';
import { esc, navMain, navTopTabs, renderSite, siteGrid } from '../src/lib/nav-render';
import type { NavCategoryRenderable } from '../src/lib/nav-render';

const CATS: NavCategoryRenderable[] = [
  {
    id: 'c1',
    name: 'AI 工具',
    icon: '🤖',
    sort: 0,
    sites: [
      { id: 's1', name: 'ChatGPT', url: 'https://chat.openai.com', icon: null, desc: '对话助手', categoryId: 'c1', subCategoryId: 'sub1' },
      { id: 's2', name: 'Claude', url: 'https://claude.ai', icon: null, desc: null, categoryId: 'c1', subCategoryId: null },
    ],
    subCategories: [{ id: 'sub1', name: '对话', sort: 0 }],
  },
  { id: 'c2', name: '设计', icon: null, sort: 1, sites: [], subCategories: [] },
];

/** 统计标签出现次数（用于粗检开闭配平） */
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe('navTopTabs', () => {
  it('渲染「全部」+ 各分类 + 添加分类按钮', () => {
    const html = navTopTabs(CATS, true);
    expect(html).toContain('data-cat-tab="all"');
    expect(html).toContain('data-cat-name="全部网站"');
    expect(html).toContain('data-cat-tab="c1"');
    expect(html).toContain('data-cat-tab="c2"');
    expect(html).toContain('data-cat-add');
  });

  it('游客不渲染添加分类按钮', () => {
    expect(navTopTabs(CATS, false)).not.toContain('data-cat-add');
  });
});

describe('navMain', () => {
  const html = navMain(CATS, true, 2);

  it('含标题锚点、全部面板与各分类面板', () => {
    expect(html).toContain('id="nav-title"');
    expect(html).toContain('data-cat-panel="all"');
    expect(html).toContain('data-cat-panel="c1"');
    expect(html).toContain('data-cat-panel="c2"');
  });

  it('除「全部」外的面板默认 hidden，由客户端 activate 显隐', () => {
    expect(html).toContain('data-cat-panel="c1" class="hidden"');
    expect(html).not.toContain('data-cat-panel="all" class="hidden"');
  });

  it('含左侧分类栏（分类按钮即拖拽落点）与统计文案', () => {
    expect(html).toContain('<aside');
    expect(html).toContain('data-drop-cat="c1"');
    expect(html).toContain('共 2 个分类 · 2 个网站');
  });

  it('分类面板含未分组/子分类落点、添加网址与添加子分类表单', () => {
    expect(html).toContain('data-drop-sub=""');
    expect(html).toContain('data-drop-sub="sub1"');
    expect(html).toContain('data-site-add="c1"');
    expect(html).toContain('data-sub-add-form="c1"');
  });

  it('空分类也要给出添加网址/子分类入口（否则无法补数据）', () => {
    expect(html).toContain('data-site-add="c2"');
    expect(html).toContain('data-sub-add-form="c2"');
  });

  it('管理态卡片可拖拽并带编辑/删除按钮', () => {
    expect(html).toContain('draggable="true" data-site-id="s1"');
    expect(html).toContain('data-site-edit="s1"');
    expect(html).toContain('data-site-del="s1"');
  });

  it('无分类时渲染空态与添加分类按钮', () => {
    const empty = navMain([], true, 0);
    expect(empty).toContain('暂无分类');
    expect(empty).toContain('data-cat-add');
  });

  it('游客态不出现任何管理控件', () => {
    const guest = navMain(CATS, false, 2);
    expect(guest).not.toContain('data-site-add');
    expect(guest).not.toContain('data-site-del');
    expect(guest).not.toContain('data-cat-add');
    expect(guest).not.toContain('data-drop-cat');
  });

  it('div / button / span 开闭配平', () => {
    expect(count(html, /<div/g)).toBe(count(html, /<\/div>/g));
    expect(count(html, /<button/g)).toBe(count(html, /<\/button>/g));
    expect(count(html, /<span/g)).toBe(count(html, /<\/span>/g));
  });
});

describe('转义', () => {
  it('名称/简介里的引号与尖括号不会破坏属性', () => {
    const html = renderSite(
      { id: 'x', name: 'a"b<c>', url: 'https://x.com', icon: null, desc: 'd"e', categoryId: 'c1' },
      false,
    );
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;c&gt;');
    expect(html).not.toContain('a"b');
  });

  it('esc 覆盖 & < > " \'', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('siteGrid 用空 categoryId 时不渲染添加按钮（「全部网站」面板）', () => {
    const html = siteGrid([], '', false);
    expect(html).toContain('<div class="grid');
    expect(html).not.toContain('data-site-add');
  });
});

describe('新增分类后的顺序', () => {
  it('sort 相同的稳定排序与后端 orderBy(sort, createdAt) 一致（新分类排在末尾）', () => {
    const added: NavCategoryRenderable = { id: 'c3', name: '新分类', icon: null, sort: 0, sites: [], subCategories: [] };
    // 客户端 renderAll 前的 syncOrder 就是这一步：稳定排序保住已有先后
    const ids = [...CATS, added].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((c) => c.id);
    expect(ids).toEqual(['c1', 'c3', 'c2']);
  });
});
