/**
 * 后台「导航管理」页标记渲染（**服务端与客户端共用**的纯函数模块）
 *
 * 与 `nav-render.ts` 同一套思路：后台导航管理页原本把分类列表 / 网站分组列表直接写在
 * `src/pages/admin/nav.astro` 的模板里 —— 只能服务端渲染，于是每次增删改都只能
 * `window.location.reload()`。整页重载虽然不会跳回默认页（本页只有一个全量视图），
 * 但会**丢掉滚动位置**：列表一长，改一项就被弹回顶部。
 *
 * 把标记生成抽到本模块后，客户端脚本用同一套函数就地重建，不再整页刷新。
 *
 * 约束：本模块必须同构（isomorphic）—— 只允许纯字符串/数据操作，
 * **不得** import `@/lib/nav`（会带进 drizzle / better-sqlite3，客户端打包会炸）。
 */

import { esc } from './nav-render';

/* ================= 数据类型 ================= */

/** 排序键：服务端 `ORDER BY sort ASC, createdAt ASC`（实现见 `@/lib/ordered-list`） */
import type { Sortable } from './ordered-list';
export type { Sortable };

/** 渲染一个网站行所需的最小字段 */
export interface AdminSiteRenderable extends Sortable {
  id: string;
  name: string;
  url: string;
}

/** 渲染一个分类（及其网站）所需的最小字段 */
export interface AdminCategoryRenderable extends Sortable {
  id: string;
  name: string;
  icon: string | null;
  sites: AdminSiteRenderable[];
}

/* ================= 样式常量（与模板保持一字不差） ================= */

const CAT_LI_CLASS = 'flex items-center justify-between gap-3 px-3 py-2';
const CAT_ROW_CLASS = 'flex min-w-0 items-center gap-2';
const CAT_ACTIONS_CLASS = 'flex shrink-0 gap-2 text-xs';
const SITE_LI_CLASS = 'flex items-center justify-between gap-3 px-3 py-2';
const SITE_ACTIONS_CLASS = 'flex shrink-0 items-center gap-2 text-xs';
const BTN_EDIT_CLASS = 'rounded-md border border-border px-2 py-1 hover:border-primary hover:text-primary';
const BTN_DEL_CLASS = 'rounded-md border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive/10';
const SELECT_MOVE_CLASS = 'rounded-md border border-input bg-background px-1.5 py-1 outline-none';

/* ================= 渲染 ================= */

/** 分类列表（`#cat-list` 的 innerHTML）：图标 + 名称 + 网站数 + 编辑/删除 */
export function adminCatList(categories: AdminCategoryRenderable[]): string {
  return categories
    .map(
      (c) =>
        `<li class="${CAT_LI_CLASS}">` +
        `<div class="${CAT_ROW_CLASS}">` +
        (c.icon ? `<span class="shrink-0 text-sm">${esc(c.icon)}</span>` : '') +
        `<span class="truncate text-sm font-medium">${esc(c.name)}</span>` +
        `<span class="font-pixel text-[0.55rem] text-muted-foreground">${c.sites.length} 站</span>` +
        `</div>` +
        `<div class="${CAT_ACTIONS_CLASS}">` +
        `<button type="button" data-cat-edit="${esc(c.id)}" class="${BTN_EDIT_CLASS}">编辑</button>` +
        `<button type="button" data-cat-del="${esc(c.id)}" data-cat-name="${esc(c.name)}" class="${BTN_DEL_CLASS}">删除</button>` +
        `</div>` +
        `</li>`,
    )
    .join('');
}

/**
 * 网站分组列表（`#site-groups` 的 innerHTML）：按分类分组，每组内可移动分类/编辑/删除。
 *
 * 「移动到」下拉列出**全部**分类，当前所属分类预选中。
 */
export function adminSiteGroups(categories: AdminCategoryRenderable[]): string {
  return categories
    .map((c) => {
      const rows =
        c.sites.length === 0
          ? `<li class="px-3 py-2 text-xs text-muted-foreground">暂无网站</li>`
          : c.sites
              .map(
                (s) =>
                  `<li class="${SITE_LI_CLASS}">` +
                  `<div class="min-w-0">` +
                  `<p class="truncate text-sm font-medium">${esc(s.name)}</p>` +
                  `<p class="truncate text-xs text-muted-foreground">${esc(s.url)}</p>` +
                  `</div>` +
                  `<div class="${SITE_ACTIONS_CLASS}">` +
                  `<select data-site-move="${esc(s.id)}" class="${SELECT_MOVE_CLASS}">` +
                  categories
                    .map(
                      (c2) =>
                        `<option value="${esc(c2.id)}"${c2.id === c.id ? ' selected' : ''}>${esc(c2.name)}</option>`,
                    )
                    .join('') +
                  `</select>` +
                  `<button type="button" data-site-edit="${esc(s.id)}" class="${BTN_EDIT_CLASS}">编辑</button>` +
                  `<button type="button" data-site-del="${esc(s.id)}" data-site-name="${esc(s.name)}" class="${BTN_DEL_CLASS}">删除</button>` +
                  `</div>` +
                  `</li>`,
              )
              .join('');
      return (
        `<div>` +
        `<h3 class="flex items-center gap-2 text-xs">` +
        (c.icon ? `<span>${esc(c.icon)}</span>` : '') +
        `<span class="font-pixel uppercase tracking-wider text-primary">${esc(c.name)}</span>` +
        `<span class="h-px flex-1 bg-border"></span>` +
        `</h3>` +
        `<ul class="mt-2 list-blend">${rows}</ul>` +
        `</div>`
      );
    })
    .join('');
}

/** 「新增网站」表单里的分类下拉（`#site-cat` 的 innerHTML） */
export function adminCatOptions(categories: AdminCategoryRenderable[]): string {
  return categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}

/* ================= 排序工具 =================
 * 实现已移到 `@/lib/ordered-list`（文档库 doc.astro 等也要用同一套语义），
 * 这里 re-export 以保持既有导入路径不变。
 */
export { insertOrdered, removeById } from './ordered-list';
