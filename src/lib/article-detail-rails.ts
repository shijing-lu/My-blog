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
  const panel = get<HTMLElement>('doc-toc-panel');
  if (collapsed && panel?.contains(document.activeElement)) fab?.focus({ preventScroll: true });
  if (panel) {
    panel.inert = collapsed;
    panel.setAttribute('aria-hidden', String(collapsed));
  }
  button?.setAttribute('aria-expanded', String(!collapsed));
  fab?.setAttribute('aria-expanded', String(!collapsed));
  if (button) button.title = collapsed ? '展开目录' : '收起目录';
  if (persist) remember(RIGHT_KEY, collapsed);
}

function applyRightAuto(): void {
  const aside = get<HTMLElement>('doc-toc-aside');
  if (!aside) return;
  const auto = window.innerWidth < RIGHT_AUTO_WIDTH;
  // 软键盘和移动浏览器地址栏也会触发 resize，不应因此关闭正在使用的目录。
  if (aside.dataset.auto === String(auto)) return;
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
  fab.addEventListener('click', () => {
    applyRight(false, aside.dataset.auto !== 'true');
    get<HTMLButtonElement>('doc-toc-toggle')?.focus({ preventScroll: true });
  });
  overlay?.addEventListener('click', () => applyRight(true, false));
  aside.addEventListener('click', (event) => {
    if (aside.dataset.auto !== 'true' || !(event.target instanceof Element)) return;
    if (event.target.closest('a[data-doc-anchor]')) applyRight(true, false);
  });
  // 与网站顶部导航的实际高度对齐，Android 原生栏不属于 WebView 视口。
  const header = get<HTMLElement>('site-header');
  const place = (): void => {
    const bottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    aside.style.setProperty('--article-toc-top', `${bottom + 16}px`);
    overlay?.style.setProperty('--article-toc-overlay-top', `${bottom}px`);
  };
  place();
  if (header) {
    const observer = new ResizeObserver(place);
    observer.observe(header);
    document.addEventListener('astro:before-swap', () => observer.disconnect(), { once: true });
  }
  applyRightAuto();
}

export function setupArticleDetailRails(): void {
  setupLeft();
  setupRight();
  if (resizeBound) return;
  resizeBound = true;
  document.addEventListener('keydown', (event) => {
    const aside = get<HTMLElement>('doc-toc-aside');
    if (event.key === 'Escape' && aside?.dataset.collapsed === 'false') {
      applyRight(true, aside.dataset.auto !== 'true');
    }
  });
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyRightAuto, 120);
  });
}
