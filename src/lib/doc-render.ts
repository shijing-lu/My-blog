/**
 * /doc 文档库标记渲染（**服务端与客户端共用**的纯函数模块）
 *
 * 与 `nav-render.ts` / `admin-nav-render.ts` 同一套思路：文档库原本把分类侧栏、
 * 页头统计、分类分组的文档书架全部内联在 `src/pages/doc.astro` 模板里 —— 只能服务端渲染，
 * 于是分类/文档的增删改只能 `window.location.reload()`。而根容器上的
 * `data-managing`（管理态）与 `data-active-cat`（分类筛选）由 SSR 输出复位，
 * reload 就等于「每加一个就退出管理态 + 丢掉当前筛选」，没法连着加。
 *
 * 抽到本模块后，客户端改完内存里的 TREE 就能就地重建，管理态与筛选态原样保留。
 *
 * 约束：本模块必须同构（isomorphic）—— 只允许纯字符串/数据操作，
 * **不得** import `@/lib/docs`（会带进 drizzle / better-sqlite3，客户端打包会炸）。
 */

import { esc } from './nav-render';

/* ================= 数据类型 ================= */

/** 分类侧栏一项所需的最小字段 */
export interface DocNavCategoryRenderable {
  id: string;
  name: string;
  /** 该分类下的文档（册）数量 */
  bundleCount: number;
}

/** 文档卡片所需的最小字段 */
export interface DocBundleRenderable {
  id: string;
  name: string;
  icon: string | null;
  summary: string | null;
  articleCount: number;
  folderCount: number;
}

/** 分类分组所需的最小字段 */
export interface DocCategoryRenderable {
  id: string;
  name: string;
  bundles: DocBundleRenderable[];
}

/* ================= 样式常量（与模板保持一字不差） ================= */

const NAV_BTN_CLASS = 'filter-category';
const SECTION_EMPTY_CLASS = 'mt-2 text-sm text-muted-foreground';
const BUNDLE_GRID_CLASS = 'mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2';
const ADD_CAT_CLASS =
  'doc-manage-only rounded-full border border-dashed border-border px-5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary';
const ADD_CAT_EMPTY_CLASS =
  'doc-manage-only mt-4 rounded-full border border-dashed border-border px-6 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary';
const ADD_BUNDLE_CLASS =
  'doc-manage-only mt-3 rounded-full border border-dashed border-border px-5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary';

/** 管理态小图标按钮：size 区分分类（5）与文档（4） */
function iconBtn(size: '5' | '4', danger: boolean): string {
  const accent = danger
    ? 'hover:border-destructive/50 hover:text-destructive focus-visible:border-destructive/50 focus-visible:text-destructive'
    : 'hover:border-primary/50 hover:text-primary focus-visible:border-primary/50 focus-visible:text-primary';
  return (
    `inline-flex size-${size} items-center justify-center rounded-full icon-btn-tap border border-border ` +
    `bg-card text-[0.6rem] text-muted-foreground transition-colors ${accent}`
  );
}

/* ================= 渲染 ================= */

/**
 * 分类筛选侧栏（与 `DocCategoryNav.astro` 同源）：
 * 「全部」+ 各分类按钮，点击 = 当前页内即时筛选（无请求、无刷新）。
 *
 * 页面上出现两次（桌面侧栏 + 窄屏 `<details>`），两处都由 `applyCat` 统一同步选中态。
 */
export function docCategoryNav(categories: DocNavCategoryRenderable[], total: number): string {
  let html =
    `<button type="button" class="${NAV_BTN_CLASS} active" data-doc-cat-filter="all" aria-pressed="true" title="显示全部分类">` +
    `<span class="filter-category-name">全部</span>` +
    `<span class="filter-category-count">${total}</span>` +
    `</button>`;
  for (const c of categories) {
    html +=
      `<button type="button" class="${NAV_BTN_CLASS}" data-doc-cat-filter="${esc(c.id)}" aria-pressed="false" ` +
      `title="只看「${esc(c.name)}」">` +
      `<span class="filter-category-name">${esc(c.name)}</span>` +
      `<span class="filter-category-count">${c.bundleCount}</span>` +
      `</button>`;
  }
  return html;
}

/** 页头统计文案：N 个分类 · M 册 · K 篇 */
export function docStats(catCount: number, bundleCount: number, articleCount: number): string {
  return `${catCount} 个分类 · ${bundleCount} 册 · ${articleCount} 篇`;
}

/** 无分类时的空态 */
export function docEmptyState(authed: boolean): string {
  return (
    `<p class="text-sm text-muted-foreground">暂无文档 —— 管理员可在这里添加分类与文档。</p>` +
    (authed
      ? `<button type="button" data-doc-cat-add class="${ADD_CAT_EMPTY_CLASS}">＋ 添加分类</button>`
      : '')
  );
}

/**
 * 分类分组书架（主体内容）。
 *
 * 与 SSR 模板一致：管理态才渲染空分类与全部管理按钮；非管理态下
 * `bundles.length === 0` 的分类整个不出现（避免游客看到空分类）。
 */
export function docSections(categories: DocCategoryRenderable[], authed: boolean): string {
  let html = '';
  if (authed) {
    html += `<div class="flex justify-end"><button type="button" data-doc-cat-add class="${ADD_CAT_CLASS}">＋ 添加分类</button></div>`;
  }
  for (const c of categories) {
    if (c.bundles.length === 0 && !authed) continue;
    const empty = c.bundles.length === 0;
    html +=
      `<section class="group doc-cat-section${empty ? ' doc-cat-empty' : ''}" data-doc-section="${esc(c.id)}">` +
      `<div class="flex items-center justify-between gap-2">` +
      `<h2 class="flex items-center gap-2 text-lg font-semibold">` +
      `<span class="pixel-chip text-muted-foreground">分类</span>` +
      `${esc(c.name)}` +
      `<span class="font-pixel text-[0.55rem] text-muted-foreground">${c.bundles.length} 册</span>` +
      `</h2>` +
      (authed
        ? `<span class="doc-manage-only flex items-center gap-1">` +
          `<button type="button" data-doc-cat-edit="${esc(c.id)}" title="编辑分类" aria-label="编辑分类「${esc(c.name)}」" class="${iconBtn('5', false)}">✎</button>` +
          `<button type="button" data-doc-cat-del="${esc(c.id)}" data-doc-name="${esc(c.name)}" title="删除分类" aria-label="删除分类「${esc(c.name)}」" class="${iconBtn('5', true)}">×</button>` +
          `</span>`
        : '') +
      `</div>` +
      (empty
        ? `<p class="${SECTION_EMPTY_CLASS}">该分类暂无文档</p>`
        : `<div class="${BUNDLE_GRID_CLASS}">` +
          c.bundles
            .map(
              (b) =>
                /* 卡片外层：相对定位容器。管理按钮作为 <a> 的兄弟节点绝对定位在卡片内，
                   避免 <a> 内嵌 <button> 的非法嵌套。 */
                `<div class="relative">` +
                `<a href="/doc/${esc(b.id)}" class="doc-card block">` +
                `<p class="flex items-center gap-2 font-medium">` +
                `<span class="doc-card-name min-w-0 truncate">${esc(b.name)}</span>` +
                `</p>` +
                `<p class="mt-1.5 text-[0.6rem] text-muted-foreground">${b.articleCount} 篇${b.folderCount > 0 ? ` · ${b.folderCount} 个目录` : ''}</p>` +
                `</a>` +
                (authed
                  ? `<span class="doc-manage-only absolute right-1.5 top-1.5 z-10 flex items-center gap-1">` +
                    `<button type="button" data-doc-bundle-edit="${esc(b.id)}" title="编辑文档" aria-label="编辑文档「${esc(b.name)}」" class="${iconBtn('4', false)}">✎</button>` +
                    `<button type="button" data-doc-bundle-del="${esc(b.id)}" data-doc-name="${esc(b.name)}" title="删除文档" aria-label="删除文档「${esc(b.name)}」" class="${iconBtn('4', true)}">×</button>` +
                    `</span>`
                  : '') +
                `</div>`,
            )
            .join('') +
          `</div>`) +
      (authed
        ? `<button type="button" data-doc-bundle-add="${esc(c.id)}" class="${ADD_BUNDLE_CLASS}">＋ 添加文档</button>`
        : '') +
      `</section>`;
  }
  return html;
}

/** 汇总统计（页头文案与侧栏「全部」计数用） */
export function docTotals(categories: DocCategoryRenderable[]): {
  catCount: number;
  bundleCount: number;
  articleCount: number;
} {
  let bundleCount = 0;
  let articleCount = 0;
  for (const c of categories) {
    bundleCount += c.bundles.length;
    for (const b of c.bundles) articleCount += b.articleCount ?? 0;
  }
  return { catCount: categories.length, bundleCount, articleCount };
}
