/**
 * 导航页标记渲染（**服务端与客户端共用**的纯函数模块）
 *
 * 为什么单独抽一个模块：导航页原本把 `renderSite / siteGrid / subBlock / categoryPanel`
 * 写在 `src/pages/nav.astro` 的 frontmatter 里 —— 只能服务端渲染。于是管理端每次
 * 增删改（新增分类 / 新增网址 …）都只能 `window.location.reload()` 整页重载，
 * 而重载后 `activate('all')` 又把视图拉回「全部网站」，用户当前所在的分类丢失。
 *
 * 把标记生成抽成本模块后，客户端脚本可以拿到同一套函数，用最新数据**就地重建**
 * 分类栏与面板（见 nav.astro 的 `renderAll()`），从此不再整页刷新、也不再跳回默认页。
 *
 * 约束：本模块必须是同构（isomorphic）的 —— 只允许纯字符串/数据操作，
 * **不得** import `@/lib/nav`（那会带进 drizzle / better-sqlite3 等 Node 依赖，
 * 客户端打包会炸）。`nav.ts` 反向 re-export 本模块的 favicon 工具函数。
 */

/* ================= 数据类型 ================= */

/** 渲染一个网站卡片所需的最小字段（与 db/types 的 Website / NavCategoryView 结构兼容） */
export interface NavSiteRenderable {
  id: string;
  name: string;
  url: string;
  icon: string | null;
  desc: string | null;
  categoryId: string;
  /** 所属子分类（null / undefined = 该主分类的「未分组」区） */
  subCategoryId?: string | null;
  /** 「全部网站」面板里的归属标注（hover 提示） */
  groupLabel?: string;
}

/** 渲染一个子分类区块所需的最小字段 */
export interface NavSubRenderable {
  id: string;
  name: string;
  sort: number;
}

/** 渲染一个主分类面板所需的最小字段 */
export interface NavCategoryRenderable {
  id: string;
  name: string;
  icon: string | null;
  /** 排序权重（与后端 orderBy(sort, createdAt) 对应；客户端新增分类后就地排序用） */
  sort?: number;
  sites: NavSiteRenderable[];
  subCategories: NavSubRenderable[];
}

/* ================= favicon 工具（原在 nav.ts，移到这里以便客户端复用） ================= */

/** 从网址提取域名（如 https://www.example.com/a → example.com） */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]!.replace(/^www\./, '');
  }
}

/** 自动图标 URL：手动 icon → 域名 /favicon.ico → Google favicon 兜底 */
export function autoIconUrl(url: string, manualIcon?: string | null): string {
  if (manualIcon) return manualIcon;
  const domain = extractDomain(url);
  return `https://${domain}/favicon.ico`;
}

/** Google favicon 兜底（favicon.ico 加载失败时用） */
export function googleFaviconUrl(url: string): string {
  const domain = extractDomain(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

/* ================= 基础工具 ================= */

// HTML 转义集中在 html-escape.ts（各渲染模块共用一份，避免规则分叉）。
// 既 import（本模块内部大量使用）又 re-export（保持既有 API 不变）。
import { esc } from './html-escape';
export { esc };

/** 与「＋ 添加网址」一致的虚线圆角按钮样式 */
const ADD_BTN_CLASS =
  'rounded-full border border-dashed border-border px-6 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary';

/** 分类栏（顶部横条 / 左侧栏）里的小图标按钮样式（编辑 ✎ / 删除 ×） */
const ICON_BTN_CLASS =
  'inline-flex size-4 items-center justify-center rounded-full icon-btn-tap border border-border bg-card text-[0.6rem] leading-none text-muted-foreground transition-colors';

/* ================= 卡片 / 网格 / 分组 ================= */

/**
 * 统一卡片模板（紧凑长方形）：图标 + 名称 + 简介
 * 管理员模式下：卡片可拖拽（移动到分类）+ 右上角编辑 ✎ / 删除 ×
 */
export function renderSite(site: NavSiteRenderable, authed: boolean): string {
  const iconSrc = autoIconUrl(site.url, site.icon);
  const google = googleFaviconUrl(site.url);
  const name = site.name || '?';
  const desc = site.desc
    ? `<span class="mt-0.5 block truncate text-[0.7rem] text-muted-foreground">${esc(site.desc)}</span>`
    : '';
  const dragAttr = authed ? ` draggable="true" data-site-id="${esc(site.id)}" data-site-name="${esc(name)}"` : '';
  // 管理员：右上角操作组（编辑 ✎ + 删除 ×，常驻可见 —— 触屏/键盘无 hover）
  const actions = authed
    ? `<span class="absolute -right-1.5 -top-2 z-10 flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">` +
      `<button type="button" data-site-edit="${esc(site.id)}" title="编辑" aria-label="编辑" ` +
      `class="${ICON_BTN_CLASS} hover:border-primary/50 hover:text-primary">✎</button>` +
      `<button type="button" data-site-del="${esc(site.id)}" data-site-name="${esc(name)}" title="删除" aria-label="删除" ` +
      `class="${ICON_BTN_CLASS} hover:border-destructive/50 hover:text-destructive">×</button>` +
      `</span>`
    : '';
  return (
    `<div class="group relative">` +
    `<a href="${esc(site.url)}"${dragAttr} target="_blank" rel="noopener noreferrer" ` +
    (site.groupLabel ? `title="${esc(site.groupLabel)}" ` : '') +
    `class="flex items-center gap-2.5 p-2.5 transition-colors duration-200 hover:bg-accent/60">` +
    `<span class="relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">` +
    `<img class="nav-icon size-5 object-contain" src="${esc(iconSrc)}" alt="" loading="lazy" data-google="${esc(google)}" data-name="${esc(name)}" />` +
    `<span class="nav-icon-fallback hidden font-display text-sm font-semibold text-primary">${esc(name.slice(0, 1))}</span>` +
    `</span>` +
    `<span class="min-w-0"><span class="block truncate text-xs font-medium">${esc(name)}</span>${desc}</span>` +
    `</a>${actions}</div>`
  );
}

/** 分组内的网站网格（含底部「+ 添加网址」，携带子分类归属） */
export function siteGrid(sites: NavSiteRenderable[], categoryId: string, authed: boolean, subCategoryId = ''): string {
  const cards = sites.map((s) => renderSite(s, authed)).join('');
  const addBtn = authed
    ? `<div class="mt-3 flex justify-center">` +
      `<button type="button" data-site-add="${esc(categoryId)}" data-site-sub="${esc(subCategoryId)}" ` +
      `class="${ADD_BTN_CLASS}">＋ 添加网址</button></div>`
    : '';
  return `<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">${cards}</div>${addBtn}`;
}

/** 子分类区块：虚线分隔 + 标题行（名称/计数/管理员操作）+ 该分组的网站网格 */
export function subBlock(
  categoryId: string,
  sub: NavSubRenderable,
  sites: NavSiteRenderable[],
  authed: boolean,
): string {
  const actions = authed
    ? `<span class="ml-auto flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">` +
      `<button type="button" data-sub-edit="${esc(sub.id)}" data-sub-name="${esc(sub.name)}" title="重命名子分类" aria-label="重命名子分类" ` +
      `class="${ICON_BTN_CLASS} hover:border-primary/50 hover:text-primary">✎</button>` +
      `<button type="button" data-sub-del="${esc(sub.id)}" data-sub-name="${esc(sub.name)}" data-sub-num="${sites.length}" title="删除子分类" aria-label="删除子分类" ` +
      `class="${ICON_BTN_CLASS} hover:border-destructive/50 hover:text-destructive">×</button>` +
      `</span>`
    : '';
  const head =
    `<div class="group mb-2.5 flex items-center gap-2">` +
    `<h3 class="text-sm font-medium" data-sub-title="${esc(sub.id)}">${esc(sub.name)}</h3>` +
    `<span class="font-pixel text-[0.55rem] text-muted-foreground" data-sub-count="${esc(sub.id)}">${sites.length}</span>` +
    actions +
    `</div>`;
  const tip = authed ? ` title="拖拽网站到此处归入「${esc(sub.name)}」"` : '';
  // 空子分类：加一个明显的虚线占位区，让管理员清楚知道"这里就是放置区"
  // （原 0 高度 grid 加上紧贴的 addSubForm 容易让人误以为整片都是 drop 目标，
  //  其实只有 data-drop-sub 块内才是。占位区本身也属于子分类块，仍是合法落点）
  const emptyHint = authed && sites.length === 0
    ? `<div class="my-2 flex min-h-[56px] items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/30 px-4 text-xs text-muted-foreground" data-drop-hint>` +
      `↓ 拖拽网站到此处归入「${esc(sub.name)}」</div>`
    : '';
  return (
    `<div data-group data-group-cat="${esc(categoryId)}" data-group-sub="${esc(sub.id)}" data-drop-sub="${esc(sub.id)}"` +
    ` class="nav-drop-group mt-4 rounded-lg border-t border-dashed border-border pt-4 transition-shadow"${tip}>` +
    `${head}${emptyHint}${siteGrid(sites, categoryId, authed, sub.id)}</div>`
  );
}

/** 添加子分类内联表单（输入框 + 按钮，与「添加网址」同一行排列，样式一致） */
export function addSubForm(categoryId: string): string {
  return (
    `<div class="mt-3 flex flex-wrap items-center justify-center gap-2" data-sub-add-form="${esc(categoryId)}">` +
    `<input type="text" maxlength="50" placeholder="新子分类名" aria-label="新子分类名" data-sub-input="${esc(categoryId)}" ` +
    `class="w-40 rounded-full border border-dashed border-border bg-background px-4 py-1.5 text-center text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50" />` +
    `<button type="button" data-sub-add="${esc(categoryId)}" class="${ADD_BTN_CLASS}">＋ 添加子分类</button>` +
    `</div>`
  );
}

/**
 * 主分类面板内容：未分组区 + 各子分类区块（虚线分隔）+ 底部添加子分类表单。
 *
 * 「添加子分类」的输入框与按钮紧邻最后一个「＋ 添加网址」按钮，样式一致。
 */
export function categoryPanel(c: NavCategoryRenderable, authed: boolean): string {
  const subIds = new Set(c.subCategories.map((s) => s.id));
  // 无子分类归属、或引用了已删子分类（历史数据）的网站，都归入「未分组」
  const ungrouped = c.sites.filter((s) => !s.subCategoryId || !subIds.has(s.subCategoryId));
  // 该分类完全为空且无子分类 → 空态提示
  if (c.sites.length === 0 && c.subCategories.length === 0) {
    return authed
      ? `<div data-group data-group-cat="${esc(c.id)}" data-group-sub="" data-drop-sub="" ` +
          `class="nav-drop-group rounded-lg transition-shadow" title="拖拽网站到此处归入该分类（未分组）">` +
          `${siteGrid([], c.id, authed, '')}</div>` +
          addSubForm(c.id)
      : `<p class="text-sm text-muted-foreground">该分类暂无网站。</p>`;
  }
  // 有子分类且未分组为空 → 不渲染空的未分组区（避免空网格占位）
  const showUngrouped = ungrouped.length > 0 || c.subCategories.length === 0;
  const unTip = authed ? ` title="拖拽网站到此处归入该分类（未分组）"` : '';
  let html = showUngrouped
    ? `<div data-group data-group-cat="${esc(c.id)}" data-group-sub="" data-drop-sub="" ` +
      `class="nav-drop-group rounded-lg transition-shadow"${unTip}>${siteGrid(ungrouped, c.id, authed, '')}</div>`
    : '';
  for (const sub of c.subCategories) {
    html += subBlock(c.id, sub, c.sites.filter((s) => s.subCategoryId === sub.id), authed);
  }
  // 在"添加新子分类"表单前加分隔线，避免和上面子分类块的"拖拽归入"区视觉粘连
  if (authed) {
    if (c.subCategories.length > 0) html += `<div class="mt-6 border-t border-border/60 pt-4"></div>`;
    html += addSubForm(c.id);
  }
  return html;
}

/* ================= 分类栏 / 主体 ================= */

/**
 * 顶部吸顶分类横条内容（<1720px 显示；超宽屏改用左侧悬浮栏）。
 * 注意「全部」按钮的可见文案是「🧭 全部」，但 data-cat-name 是「全部网站」（标题用）。
 */
export function navTopTabs(categories: NavCategoryRenderable[], authed: boolean): string {
  const tabClass =
    'shrink-0 rounded-full border border-border px-3 py-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary';
  let html =
    `<button type="button" data-cat-tab="all" data-cat-name="全部网站" class="${tabClass}">🧭 全部</button>`;
  for (const c of categories) {
    html +=
      `<button type="button" data-cat-tab="${esc(c.id)}" data-cat-name="${esc(c.name)}" class="${tabClass}">` +
      `${c.icon ? `${esc(c.icon)} ` : ''}${esc(c.name)}</button>`;
  }
  if (authed) {
    html +=
      `<button type="button" data-cat-add ` +
      `class="shrink-0 rounded-full border border-dashed border-border px-3 py-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">＋ 分类</button>`;
  }
  return html;
}

/**
 * 左侧悬浮分类栏（≥1720px 显示）：分类列表 + 编辑/删除 + 添加分类 + 拖拽提示。
 * 分类按钮同时是「拖拽网站卡片到此可移动」的落点（data-drop-cat）。
 */
export function navSidebar(categories: NavCategoryRenderable[], authed: boolean): string {
  const tabClass =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 pr-6 text-left text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground';
  let items =
    `<button type="button" data-cat-tab="all" data-cat-name="全部网站" class="${tabClass}">` +
    `<span aria-hidden="true">🧭</span><span>全部网站</span></button>`;
  for (const c of categories) {
    const dragAttrs = authed
      ? ` data-drop-cat="${esc(c.id)}" draggable="true" title="拖拽可排序；拖拽网站卡片到此处可移动"`
      : '';
    const actions = authed
      ? `<span class="absolute -top-1.5 right-0 z-10 flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">` +
        `<button type="button" data-cat-edit="${esc(c.id)}" title="编辑分类" aria-label="编辑分类" ` +
        `class="${ICON_BTN_CLASS} hover:border-primary/50 hover:text-primary">✎</button>` +
        `<button type="button" data-cat-del="${esc(c.id)}" data-cat-name="${esc(c.name)}" title="删除分类" aria-label="删除分类" ` +
        `class="${ICON_BTN_CLASS} hover:border-destructive/50 hover:text-destructive">×</button>` +
        `</span>`
      : '';
    items +=
      `<div class="group relative">` +
      `<button type="button" data-cat-tab="${esc(c.id)}" data-cat-name="${esc(c.name)}" data-cat-id="${esc(c.id)}"${dragAttrs} class="${tabClass}">` +
      (c.icon ? `<span class="shrink-0" aria-hidden="true">${esc(c.icon)}</span>` : '') +
      `<span class="truncate">${esc(c.name)}</span>` +
      `<span class="ml-auto font-pixel text-[0.55rem] text-muted-foreground">${c.sites.length}</span>` +
      `</button>${actions}</div>`;
  }
  const footer = authed
    ? `<button type="button" data-cat-add ` +
      `class="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">＋ 添加分类</button>` +
      `<p class="mt-2 border-t border-border px-1 pt-2 text-[0.6rem] text-muted-foreground">提示：拖网站卡片到分类（或分类内子分类块）移动；拖分类可排序</p>`
    : '';
  return (
    `<aside class="absolute right-[calc(100%+1.5rem)] top-0 z-30 hidden w-52 min-[1720px]:block">` +
    `<div class="p-3">` +
    `<p class="pixel-chip mb-2 px-1 text-muted-foreground">分类 / CATEGORIES</p>` +
    `<nav class="space-y-0.5 text-sm" aria-label="导航分类">${items}</nav>` +
    footer +
    `</div></aside>`
  );
}

/**
 * 主体内容（`<main>` 的全部子节点）：标题区 + 分隔线（锚定左侧分类栏）+ 各分类面板。
 *
 * 「全部网站」面板跨分类平铺，hover 提示「分类 / 子分类」归属；其余面板默认 hidden，
 * 由客户端 `activate()` 按当前分类显隐。
 */
export function navMain(
  categories: NavCategoryRenderable[],
  authed: boolean,
  totalSites: number,
): string {
  if (categories.length === 0) {
    return (
      `<div class="mt-10 text-center">` +
      `<p class="text-sm text-muted-foreground">暂无分类 —— 管理员可到后台添加。</p>` +
      (authed
        ? `<button type="button" data-cat-add ` +
          `class="mt-4 rounded-full border border-dashed border-border px-6 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">＋ 添加分类</button>`
        : '') +
      `</div>`
    );
  }

  /** 子分类 id → 名称（「全部网站」面板标注归属用） */
  const subNames = new Map<string, string>();
  categories.forEach((c) => c.subCategories.forEach((s) => subNames.set(s.id, s.name)));
  const allSites: NavSiteRenderable[] = categories.flatMap((c) =>
    c.sites.map((s) => ({
      ...s,
      groupLabel: c.subCategories.length
        ? `${c.name}${s.subCategoryId && subNames.has(s.subCategoryId) ? ` / ${subNames.get(s.subCategoryId)}` : ''}`
        : c.name,
    })),
  );

  let html =
    `<div data-hero class="text-center">` +
    `<p class="font-pixel text-[0.6rem] uppercase tracking-[0.2em] text-primary">NAVIGATION</p>` +
    `<h1 id="nav-title" class="mt-1 font-display text-3xl font-semibold tracking-tight">全部网站</h1>` +
    `<p class="mt-1 text-sm text-muted-foreground">共 ${categories.length} 个分类 · ${totalSites} 个网站</p>` +
    `</div>`;
  html +=
    `<div class="relative mt-5"><div class="pixel-divider"></div>` +
    navSidebar(categories, authed) +
    `</div>`;
  html += `<div class="mt-6">`;
  html += `<div data-cat-panel="all">${siteGrid(allSites, '', false)}</div>`;
  for (const c of categories) {
    html += `<div data-cat-panel="${esc(c.id)}" class="hidden">${categoryPanel(c, authed)}</div>`;
  }
  html += `</div>`;
  return html;
}
