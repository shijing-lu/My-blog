/**
 * 授权管理页（`/admin/auth`）标记渲染（**服务端与客户端共用**的纯函数模块）
 *
 * 与 `nav-render.ts` / `admin-nav-render.ts` / `doc-render.ts` 同一套思路。
 *
 * 原本该页把「权限申请」与「授权管理员」两块列表内联在 Astro 模板里，只能服务端渲染，
 * 于是每次审批 / 保存权限 / 升降级 / 移除 / 添加都只能 `window.location.reload()`。
 * 而这个页面的典型用法是：**逐行勾好权限、再逐个点「同意并授权」** ——
 * 审批第 1 行触发的整页刷新会把第 2、3、4 行里刚勾好、还没提交的权限**全部抹掉**，
 * 必须从头再勾一遍。
 *
 * 抽到本模块后，客户端只重绘受影响的那一块列表，并在重绘前后快照/回贴勾选态
 * （见 `auth.astro` 的 `refreshLists`），其它行未保存的勾选因此得以保留。
 *
 * 约束：本模块必须同构（isomorphic）—— 只允许纯字符串/数据操作，
 * **不得** import `@/lib/admin-auth`（会带进 drizzle / better-sqlite3，客户端打包会炸）。
 * 因此权限项 `[key, label]` 由调用方以 `data-perm-entries` 属性传入，而非在此 import。
 */

import { esc } from './nav-render';

/* ================= 数据类型 ================= */

/** 权限项：`PERMISSION_KEYS` 的 `[key, label]` 对 */
export type PermEntries = ReadonlyArray<readonly [string, string]>;

/** 权限申请行所需的最小字段 */
export interface AuthApplicationRenderable {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
  note: string;
}

/** 授权管理员行所需的最小字段 */
export interface AuthAccountRenderable {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
  role: 'top' | 'admin';
  permissions: string[];
}

/* ================= 样式常量（与模板保持一字不差） ================= */

const ROW_CLASS = 'rounded-md border border-border p-4';
const EMPTY_CLASS = 'rounded-md border border-border p-4 text-sm text-muted-foreground';
const PERM_ROW_CLASS = 'mt-3 flex flex-wrap gap-x-4 gap-y-1.5';
const BTN_PRIMARY =
  'rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity duration-200 hover:opacity-90';
const BTN_PLAIN = 'rounded-md border border-border px-3 py-1.5 text-xs transition-colors duration-200 hover:bg-accent';
const BTN_DANGER =
  'rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive transition-colors duration-200 hover:bg-destructive/10';

/* ================= 内部小件 ================= */

/** 头像（无 URL 时整块不输出，与模板 `{x.avatarUrl && <img …/>}` 一致） */
function avatar(url: string): string {
  return url ? `<img src="${esc(url)}" alt="" class="size-9 rounded-full" loading="lazy" />` : '';
}

/** 姓名 + @login 两行 */
function identity(name: string, login: string): string {
  return (
    `<div class="min-w-0 flex-1">` +
    `<p class="truncate text-sm font-medium">${esc(name || login)}</p>` +
    `<p class="text-xs text-muted-foreground">@${esc(login)}</p>` +
    `</div>`
  );
}

/** 单个权限勾选项；`attr` 区分 `data-app-perm` / `data-acc-perm` */
function permLabel(attr: string, key: string, label: string, checked: boolean): string {
  return (
    `<label class="flex items-center gap-1.5 text-xs text-muted-foreground">` +
    `<input type="checkbox" ${attr}="${esc(key)}"${checked ? ' checked' : ''} class="accent-[var(--color-primary)]" />` +
    `${esc(label)}` +
    `</label>`
  );
}

/** 一组权限勾选项 */
function permRow(attr: string, entries: PermEntries, isChecked: (key: string) => boolean): string {
  let html = `<div class="${PERM_ROW_CLASS}">`;
  for (const [key, label] of entries) html += permLabel(attr, key, label, isChecked(key));
  return html + `</div>`;
}

function button(action: string, cls: string, text: string): string {
  return `<button type="button" data-action="${esc(action)}" class="${cls}">${esc(text)}</button>`;
}

/* ================= 渲染 ================= */

/**
 * 权限申请列表（含空态）。
 *
 * 空态文案与列表项都在同一容器 `#app-list` 内 —— 客户端整体重绘该容器，
 * 因此空态必须由本函数输出（不能只留在模板里，否则删空后不会显示提示）。
 */
export function authAppList(applications: AuthApplicationRenderable[], entries: PermEntries): string {
  if (applications.length === 0) {
    return `<p class="${EMPTY_CLASS}">暂无待审申请。</p>`;
  }
  let html = '';
  for (const app of applications) {
    html +=
      `<div class="${ROW_CLASS}" data-app-id="${esc(app.id)}">` +
      `<div class="flex items-center gap-3">` +
      avatar(app.avatarUrl) +
      identity(app.name, app.login) +
      `<span class="pixel-chip rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">待审</span>` +
      `</div>` +
      (app.note ? `<p class="mt-2 text-sm text-muted-foreground">${esc(app.note)}</p>` : '') +
      permRow('data-app-perm', entries, () => false) +
      `<div class="mt-3 flex gap-2">` +
      button('approve', BTN_PRIMARY, '同意并授权') +
      button('reject', BTN_PLAIN, '拒绝') +
      `</div>` +
      `</div>`;
  }
  return html;
}

/**
 * 授权管理员列表（含空态）。
 *
 * 角色分支与模板一致：
 * - `top`：不渲染权限勾选（自动拥有全部权限），操作只有「降为普通管理员 / 移除」；
 * - `admin`：渲染权限勾选，操作有「保存权限 / 设为顶级管理员 / 移除」。
 */
export function authAccList(accounts: AuthAccountRenderable[], entries: PermEntries): string {
  if (accounts.length === 0) {
    return `<p class="${EMPTY_CLASS}">暂无 GitHub 授权管理员 —— 同意访客申请后自动建立。</p>`;
  }
  let html = '';
  for (const acc of accounts) {
    const isTop = acc.role === 'top';
    html +=
      `<div class="${ROW_CLASS}" data-acc-id="${esc(acc.id)}">` +
      `<div class="flex items-center gap-3">` +
      avatar(acc.avatarUrl) +
      identity(acc.name, acc.login) +
      `<span class="pixel-chip rounded px-2 py-0.5 text-xs ${isTop ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}">` +
      `${isTop ? '顶级管理员' : '普通管理员'}` +
      `</span>` +
      `</div>` +
      (isTop
        ? `<p class="mt-2 text-xs text-primary">顶级管理员自动拥有全部权限（无需逐项授权，后续新增功能亦自动获得）。</p>`
        : permRow('data-acc-perm', entries, (key) => acc.permissions.includes(key))) +
      `<div class="mt-3 flex flex-wrap gap-2">` +
      (isTop
        ? button('demote', BTN_PLAIN, '降为普通管理员') + button('remove', BTN_DANGER, '移除')
        : button('save', BTN_PRIMARY, '保存权限') +
          button('promote', BTN_PLAIN, '设为顶级管理员') +
          button('remove', BTN_DANGER, '移除')) +
      `</div>` +
      `</div>`;
  }
  return html;
}
