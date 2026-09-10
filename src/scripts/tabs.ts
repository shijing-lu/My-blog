/**
 * 选项卡组交互（原生 JS，无依赖）
 *
 * 对应 Markdown 语法 `:::tabs#id` + `@tab`（解析见 src/lib/mdx-plugins.ts 的
 * remarkTabs，SSR 结构见 src/components/mdx/Tabs.tsx）。
 *
 * ## 为什么用原生脚本而非 React 岛
 *
 * 正文由 `renderMdx` 用 `renderToString` 直出 HTML（不经客户端水合），
 * 因此选项卡的交互只能靠「SSR 结构 + 渐进增强脚本」实现——
 * 与 copy-button / lightbox 同一模式：**document 级事件委托**，
 * View Transitions（ClientRouter）转场后自动对新 DOM 生效，无需重绑。
 *
 * ## 职责
 *
 * 1. 点击 / 键盘（←→/Home/End）切换选项卡；
 * 2. **跨组联动**：同页所有 `[data-tabs-stable-id]` 值相同的组同步选中，
 *    对齐优先用 `data-tab-anchor` 锚点，无锚点时回落到序号；
 * 3. 横向滚动：卡栏原生 `overflow-x:auto`，脚本额外让**选中的选项卡在卡栏内可见**
 *    （窄屏下切换后自动把它带进可见区）。
 *
 * ## ⚠️ 绝不影响页面滚动位置
 *
 * 切换选项卡**必须只在卡栏内部横向滚动**，不能带动页面上下跳。
 * 因此这里一律手动调整卡栏的 `scrollLeft`（见 `scrollTabIntoView`），
 * 且焦点用 `focus({ preventScroll: true })`——**禁用 `scrollIntoView()`**，
 * 它会连带滚动所有可滚动的祖先（含页面本身）。
 *
 * ## 幂等
 *
 * 用 `window.__tabsBound` 守卫：ClientRouter 转场会重新执行脚本，
 * 但事件都是委托在 `document` 上，只需绑定一次。
 */

/** 选项卡组容器选择器 */
const GROUP_SEL = '.md-tabs';

/** 当前全局绑定标记（View Transition 重执行脚本时避免重复绑定） */
interface TabsWindow extends Window {
  __tabsBound?: boolean;
}

/**
 * 把卡栏内某个选项卡滚入视野。
 *
 * ⚠️ **不能用 `scrollIntoView`**：它会连带滚动**所有可滚动的祖先**
 * （含页面本身），导致切换选项卡时整页往下跳。这里只手动调整卡栏
 * 自身的 `scrollLeft`，完全不影响页面滚动位置。
 *
 * @param nav  卡栏元素（.md-tabs-nav）
 * @param tab  目标选项卡
 */
function scrollTabIntoView(nav: HTMLElement | null, tab: HTMLElement | undefined): void {
  if (!nav || !tab) return;
  // 卡栏未溢出时无需滚动
  if (nav.scrollWidth <= nav.clientWidth + 1) return;

  const tabLeft = tab.offsetLeft;
  const tabRight = tabLeft + tab.offsetWidth;
  const viewLeft = nav.scrollLeft;
  const viewRight = viewLeft + nav.clientWidth;

  // 已在视野内 → 不动（避免无谓的横向跳动）
  if (tabLeft >= viewLeft && tabRight <= viewRight) return;

  // 左侧被裁 → 对齐到左缘；右侧被裁 → 对齐到右缘
  let next = viewLeft;
  if (tabLeft < viewLeft) next = tabLeft;
  else if (tabRight > viewRight) next = tabRight - nav.clientWidth;

  nav.scrollLeft = Math.max(0, next);
}

/**
 * 在单个组内切换选中项。
 *
 * @param group 选项卡组容器（.md-tabs）
 * @param index 目标序号
 */
function selectInGroup(group: HTMLElement, index: number): void {
  const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > .md-tabs-nav [role="tab"]'));
  const panels = Array.from(group.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]'));
  if (index < 0 || index >= tabs.length) return;

  tabs.forEach((tab, i) => {
    const on = i === index;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
  });
  panels.forEach((panel, i) => {
    if (i === index) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  });

  // 让选中的选项卡在卡栏内可见（只动卡栏 scrollLeft，不碰页面滚动）
  scrollTabIntoView(group.querySelector<HTMLElement>(':scope > .md-tabs-nav'), tabs[index]);
}

/** 读取组内的选中序号 */
function currentIndex(group: HTMLElement): number {
  const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > .md-tabs-nav [role="tab"]'));
  return tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
}

/** 读取组内某个序号对应的锚点（无锚点返回空串） */
function anchorAt(group: HTMLElement, index: number): string {
  const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > .md-tabs-nav [role="tab"]'));
  return tabs[index]?.dataset.tabAnchor ?? '';
}

/** 找到某序号在目标组中的对齐位置（优先锚点，回落序号） */
function resolveIndex(target: HTMLElement, anchor: string, fallback: number): number {
  const tabs = Array.from(target.querySelectorAll<HTMLButtonElement>(':scope > .md-tabs-nav [role="tab"]'));
  if (anchor) {
    const byAnchor = tabs.findIndex((t) => t.dataset.tabAnchor === anchor);
    if (byAnchor !== -1) return byAnchor;
  }
  if (fallback >= 0 && fallback < tabs.length) return fallback;
  return -1;
}

/**
 * 切换到指定组的某个序号，并同步所有 stableId 相同的其他组。
 */
function activate(group: HTMLElement, index: number): void {
  selectInGroup(group, index);
  const stableId = group.dataset.tabsStableId;
  if (!stableId) return;
  const anchor = anchorAt(group, index);
  document.querySelectorAll<HTMLElement>(`${GROUP_SEL}[data-tabs-stable-id]`).forEach((other) => {
    if (other === group) return;
    if (other.dataset.tabsStableId !== stableId) return;
    const next = resolveIndex(other, anchor, index);
    if (next !== -1) selectInGroup(other, next);
  });
}

/** 首次加载：把选中项在卡栏内滚入视野（窄屏下避免选中项被裁在卡栏外） */
function ensureVisibleOnLoad(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(GROUP_SEL).forEach((group) => {
    const i = currentIndex(group);
    if (i < 0) return;
    const tabs = Array.from(
      group.querySelectorAll<HTMLButtonElement>(':scope > .md-tabs-nav [role="tab"]'),
    );
    // 只调整卡栏自身 scrollLeft，绝不触发页面滚动
    scrollTabIntoView(group.querySelector<HTMLElement>(':scope > .md-tabs-nav'), tabs[i]);
  });
}

/** 绑定（仅一次） */
if (!(window as TabsWindow).__tabsBound) {
  (window as TabsWindow).__tabsBound = true;

  // 点击委托：任何 [role=tab] 点击 → 激活所在组并联动
  document.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (!tab) return;
    const group = tab.closest<HTMLElement>(GROUP_SEL);
    if (!group) return;
    // 只处理本语法产出的直接子级选项卡（避免误伤其他 tablist 组件）
    if (tab.parentElement?.classList.contains('md-tabs-nav') !== true) return;
    const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > .md-tabs-nav [role="tab"]'));
    const index = tabs.indexOf(tab);
    if (index === -1) return;
    activate(group, index);
  });

  // 键盘委托：←→ / Home / End 在卡栏内移动选中
  document.addEventListener('keydown', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (!tab) return;
    const group = tab.closest<HTMLElement>(GROUP_SEL);
    if (!group) return;
    const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(':scope > .md-tabs-nav [role="tab"]'));
    const total = tabs.length;
    if (total === 0) return;
    const cur = tabs.indexOf(tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (cur + 1) % total;
    else if (e.key === 'ArrowLeft') next = (cur - 1 + total) % total;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = total - 1;
    if (next === -1) return;
    e.preventDefault();
    activate(group, next);
    tabs[next]?.focus({ preventScroll: true });
  });

  // 首屏 + 转场后：把选中项滚入视野
  document.addEventListener('astro:page-load', () => ensureVisibleOnLoad(document));
  if (document.readyState !== 'loading') ensureVisibleOnLoad(document);
  else document.addEventListener('DOMContentLoaded', () => ensureVisibleOnLoad(document));
}

export {};
