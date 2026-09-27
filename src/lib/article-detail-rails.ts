/** 文档与首页文章共用左右目录的折叠/悬浮状态机。 */
const LEFT_KEY = 'doc-ltoc-collapsed';
const RIGHT_KEY = 'doc-toc-collapsed';
const RIGHT_AUTO_WIDTH = 1320;
let resizeBound = false;
let resizeTimer = 0;

function get<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function stored(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}

function remember(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* 私密模式 */ }
}

function setupLeft(): void {
  const grid = get<HTMLElement>('doc-3col');
  const button = get<HTMLButtonElement>('doc-ltoc-toggle');
  if (!grid || !button || grid.dataset.ltocBound === '1') return;
  grid.dataset.ltocBound = '1';
  const apply = (collapsed: boolean): void => {
    grid.dataset.ltocCollapsed = collapsed ? 'true' : 'false';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? '展开目录' : '收起目录');
    button.title = collapsed ? '展开目录' : '收起目录';
  };
  apply(stored(LEFT_KEY));
  button.addEventListener('click', () => {
    const next = grid.dataset.ltocCollapsed !== 'true';
    apply(next);
    remember(LEFT_KEY, next);
  });
}

function applyRight(collapsed: boolean, persist: boolean): void {
  const aside = get<HTMLElement>('doc-toc-aside');
  if (!aside) return;
  aside.dataset.collapsed = collapsed ? 'true' : 'false';
  const button = get<HTMLButtonElement>('doc-toc-toggle');
  const fab = get<HTMLButtonElement>('doc-toc-fab');
  button?.setAttribute('aria-expanded', String(!collapsed));
  fab?.setAttribute('aria-expanded', String(!collapsed));
  if (button) button.title = collapsed ? '展开目录' : '收起目录';
  if (persist) remember(RIGHT_KEY, collapsed);
}

function applyRightAuto(): void {
  const aside = get<HTMLElement>('doc-toc-aside');
  if (!aside) return;
  const auto = window.innerWidth < RIGHT_AUTO_WIDTH;
  aside.dataset.auto = auto ? 'true' : 'false';
  applyRight(auto ? true : stored(RIGHT_KEY), false);
}

function setupRight(): void {
  const aside = get<HTMLElement>('doc-toc-aside');
  const button = get<HTMLButtonElement>('doc-toc-toggle');
  const fab = get<HTMLButtonElement>('doc-toc-fab');
  const overlay = get<HTMLElement>('doc-toc-overlay');
  if (!aside || !button || !fab || aside.dataset.tocBound === '1') return;
  aside.dataset.tocBound = '1';
  button.addEventListener('click', () => applyRight(true, aside.dataset.auto !== 'true'));
  fab.addEventListener('click', () => applyRight(false, aside.dataset.auto !== 'true'));
  overlay?.addEventListener('click', () => applyRight(true, false));
  applyRightAuto();
}

export function setupArticleDetailRails(): void {
  setupLeft();
  setupRight();
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyRightAuto, 120);
  });
}
