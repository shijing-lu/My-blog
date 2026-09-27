/**
 * 文档目录树渲染（服务端与客户端共用的同构纯函数）
 *
 * 背景：`/doc/[id]` 原先目录树的增删改（拖拽移动 / 新建节点 / 删除节点 / 保存册信息）
 * 成功后一律 `window.location.reload()`。整页重载会丢掉：
 *   - 目录树里用户手动折叠的目录（SSR 恒渲染 `<details open>`，重载后全部弹开）；
 *   - 左栏 / 右栏的滚动位置；
 *   - **编辑器里尚未保存的正文** —— 本页挂了 DocInlineEditor，这是真正的数据丢失。
 *
 * 现在改为：客户端就地改内存节点表 → 用本模块重绘 `[data-doc-tree-root]`。
 * 服务端初始渲染走同一函数，保证两侧标记与排序完全一致。
 *
 * ⚠️ 硬性约束：本模块**不得** import db / drizzle / Node 内置模块，否则会被
 *    Astro `<script>` 打进客户端包（见 MEMORY.md「同构模块硬性约束」）。
 */
import { esc } from './html-escape';
import { toTime } from './ordered-list';

/** 树渲染所需的最小节点形状：服务端 `DocNodeView` 与客户端 `data-nodes` 都满足 */
export interface DocTreeItem {
  id: string;
  parentId: string | null;
  kind: 'folder' | 'article';
  title: string;
  sort: number;
  /** 服务端是 `Date`、客户端是 ISO 串；缺省按 0（此时依赖数组原始顺序） */
  createdAt?: string | Date;
  /** 正文渲染缓存版本号（`/render?v=`）：服务端 `Date`、客户端 ISO 串 */
  updatedAt?: string | Date;
  children?: DocTreeItem[];
}

export interface DocTreeRenderOpts {
  /** 登录态：决定是否渲染管理按钮与 draggable */
  authed: boolean;
  /** 所属文档 id（文章链接 `/doc/<bundleId>?article=<nodeId>` 需要） */
  bundleId: string;
  /** 当前选中文章 id：命中行高亮 */
  activeId?: string;
}

/**
 * 空态由渲染模块输出，不留在模板里。
 * 原因：客户端是**整体重绘**容器，只写在模板里的话「把节点删空」后没有任何提示。
 */
export const DOC_TREE_EMPTY_HTML =
  '<p class="px-1 py-2 text-xs text-muted-foreground">暂无内容 —— 管理员可新建目录或文章。</p>';

/** 与后端 `ORDER BY sort ASC, createdAt ASC` 等价 */
function compareNodes(a: DocTreeItem, b: DocTreeItem): number {
  if (a.sort !== b.sort) return a.sort - b.sort;
  return toTime(a.createdAt) - toTime(b.createdAt);
}

/**
 * 扁平节点 → 嵌套树（folder 可含 children）。
 * 父节点缺失（例如父节点刚被删）时按根级处理，避免节点在树里凭空消失。
 */
export function buildDocTree(flat: DocTreeItem[]): DocTreeItem[] {
  const map = new Map<string, DocTreeItem>();
  for (const n of flat) map.set(n.id, { ...n, children: [] });
  const roots: DocTreeItem[] = [];
  map.forEach((v) => {
    const parent = v.parentId ? map.get(v.parentId) : undefined;
    if (parent && parent.id !== v.id) parent.children!.push(v);
    else roots.push(v);
  });
  const sortRec = (list: DocTreeItem[]): void => {
    list.sort(compareNodes);
    for (const n of list) sortRec(n.children!);
  };
  sortRec(roots);
  return roots;
}

/**
 * 目录节点（供「移动到」下拉选择）。
 * 保持传入顺序 —— 服务端 `folderOptions` 就是扁平列表 `filter(kind==='folder')`。
 */
export function docFolderOptions(flat: DocTreeItem[]): Array<{ id: string; title: string }> {
  return flat.filter((n) => n.kind === 'folder').map((n) => ({ id: n.id, title: n.title }));
}

/** 收集 id 及其全部子孙 id（删除节点时用；服务端 DELETE 是级联删子孙） */
export function collectSubtreeIds(flat: DocTreeItem[], id: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of flat) {
    const key = n.parentId ?? '';
    const list = childrenOf.get(key);
    if (list) list.push(n.id);
    else childrenOf.set(key, [n.id]);
  }
  const out: string[] = [];
  const walk = (cur: string): void => {
    out.push(cur);
    for (const c of childrenOf.get(cur) ?? []) walk(c);
  };
  walk(id);
  return out;
}

/** 从扁平表里移除 id 及其全部子孙（返回新数组，不改入参） */
export function removeSubtree<T extends DocTreeItem>(flat: T[], id: string): T[] {
  const doomed = new Set(collectSubtreeIds(flat, id));
  return flat.filter((n) => !doomed.has(n.id));
}

/** 就地更新若干节点的字段（编辑 / 移动后同步内存表）。返回新数组。 */
export function patchNodes<T extends DocTreeItem>(
  flat: T[],
  patches: Array<{ id: string; patch: Partial<Pick<DocTreeItem, 'title' | 'parentId' | 'sort' | 'updatedAt'>> }>,
): T[] {
  const byId = new Map(patches.map((p) => [p.id, p.patch]));
  return flat.map((n) => {
    const p = byId.get(n.id);
    return p ? ({ ...n, ...p } as T) : n;
  });
}

/**
 * 递归渲染目录树（folder → details；article → 可切换链接）。
 *
 * - 登录态下文章行 `draggable`（拖拽排序 / 跨目录移动，见页内拖拽段）；
 * - 目录 `summary` 为「移入该目录末尾」落点；根级容器 `data-doc-tree-root` 为兜底落点；
 * - `<details open>`：默认全开。客户端重绘后由页面回放用户折叠态。
 */
export function renderDocTree(items: DocTreeItem[], opts: DocTreeRenderOpts): string {
  const { authed, bundleId, activeId } = opts;
  if (items.length === 0) return DOC_TREE_EMPTY_HTML;

  const walk = (list: DocTreeItem[]): string => {
    let out = '';
    for (const n of list) {
      if (n.kind === 'folder') {
        const children = walk(n.children ?? []);
        out +=
          `<details class="group doc-folder" open data-folder="${n.id}">` +
          `<summary class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"${authed ? ` data-doc-folder-target="${n.id}" data-tree-node-id="${n.id}" data-tree-node-kind="folder" data-tree-node-title="${esc(n.title)}" tabindex="0"` : ''}>` +
          `<span class="text-[0.7rem]">▸</span>` +
          `<span class="min-w-0 flex-1 truncate">${esc(n.title)}</span>` +
          (authed ? `<button type="button" data-tree-menu-trigger title="目录操作" aria-label="${esc(n.title)}的操作" class="ml-auto rounded px-1.5 text-xs text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-primary">⋯</button>` : '') +
          `</summary>` +
          (children ? `<div class="ml-3 border-l border-border pl-2">${children}</div>` : '') +
          `</details>`;
      } else {
        // href 为完整 URL：JS 正常时 preventDefault 走前端即时切换；新标签打开 / 无 JS 时直达正确文章
        out +=
          `<div${authed ? ` draggable="true" data-doc-node-id="${n.id}" data-tree-node-id="${n.id}" data-tree-node-kind="article" data-tree-node-title="${esc(n.title)}" tabindex="-1"` : ''} class="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ` +
          (n.id === activeId ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground') +
          `">` +
          `<a href="/doc/${bundleId}?article=${encodeURIComponent(n.id)}" data-article-switch="${n.id}" class="min-w-0 flex-1 truncate">${esc(n.title)}</a>` +
          (authed ? `<button type="button" data-tree-menu-trigger title="文章操作" aria-label="${esc(n.title)}的操作" class="shrink-0 rounded px-1.5 text-xs text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-primary">⋯</button>` : '') +
          `</div>`;
      }
    }
    return out;
  };

  return walk(items);
}
