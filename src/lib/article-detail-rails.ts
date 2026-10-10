/** 文档与首页文章共用左右目录的折叠/悬浮状态机。 */
const LEFT_KEY = 'doc-ltoc-collapsed';
const RIGHT_KEY = 'doc-toc-collapsed';
const RIGHT_AUTO_WIDTH = 1320;
let resizeBound = false;
let resizeTimer = 0;
let titlesBound = false;

/** Delegation survives tree redraws; complete titles are available on keyboard focus too. */
function setupDirectoryTitles(): void {
  if (titlesBound) return;
  titlesBound = true;
  let tip: HTMLDivElement | null = null;
  let owner: HTMLElement | null = null;
  const placeTip = (): void => {
    if (!tip || !owner) return;
    const rect = owner.getBoundingClientRect();
    tip.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 12))}px`;
    tip.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - tip.offsetHeight - 12))}px`;
  };
  const hide = (): void => {
    if (owner && owner.getAttribute('aria-describedby') === 'article-directory-tooltip') owner.removeAttribute('aria-describedby');
    tip?.remove(); tip = null; owner = null;
  };
  const show = (target: EventTarget | null): void => {
    const item = target instanceof Element ? target.closest<HTMLElement>('[data-directory-title]') : null;
    if (!item || !item.closest('.article-workspace,.neo-reader')) return;
    if (owner === item && tip) return;
    hide(); owner = item;
    tip = document.createElement('div'); tip.id = 'article-directory-tooltip';
    tip.className = 'article-directory-tooltip'; tip.setAttribute('role', 'tooltip');
    tip.textContent = item.dataset.directoryTitle ?? item.textContent;
    document.body.append(tip); item.setAttribute('aria-describedby', tip.id);
    placeTip();
  };
  document.addEventListener('focusin', event => show(event.target));
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerover', event => {
    if (owner === document.activeElement) return;
    show(event.target);
  });
  document.addEventListener('pointerout', event => {
    if (owner === document.activeElement) return;
    if (event.target instanceof Element && event.target.closest('[data-directory-title]')) hide();
  });
  document.addEventListener('scroll', () => {
    // Keyboard focus may scroll a long tree to reveal its item. Keep the full title visible.
    if (owner === document.activeElement) placeTip(); else hide();
  }, true);
  document.addEventListener('astro:before-swap', hide);
}

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
    const body = get<HTMLElement>('doc-ltoc-body');
    if (body) body.inert = collapsed;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? '展开目录' : '收起目录');
    button.title = collapsed ? '展开目录' : '收起目录';
  };
  apply(stored(LEFT_KEY));
  const aside = get<HTMLElement>('doc-ltoc-aside');
  aside?.addEventListener('wheel', event => {
    if (event.ctrlKey || window.innerWidth < 1024) return;
    const body = get<HTMLElement>('doc-ltoc-body');
    if (!body) return;
    event.preventDefault();
    if (grid.dataset.ltocCollapsed === 'true') return;
    const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? body.clientHeight : 1;
    body.scrollTop += event.deltaY * scale;
  }, { passive: false });
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
  const grid = get<HTMLElement>('doc-3col');
  if (grid) grid.dataset.tocCollapsed = String(collapsed);
  const button = get<HTMLButtonElement>('doc-toc-toggle');
  const fab = get<HTMLButtonElement>('doc-toc-fab');
  const panel = get<HTMLElement>('doc-toc-panel');
  if (collapsed && panel?.contains(document.activeElement)) fab?.focus({ preventScroll: true });
  if (panel) {
    panel.inert = collapsed;
    panel.setAttribute('aria-hidden', String(collapsed));
    if (!collapsed && aside.dataset.auto === 'true') {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'article-directory-title');
    } else {
      panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.removeAttribute('aria-labelledby');
    }
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
  const grid = get<HTMLElement>('doc-3col');
  if (grid) grid.dataset.tocAuto = String(auto);
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
    const columns = document.querySelector<HTMLElement>('#doc-3col,.reader-columns');
    const start = Math.max(bottom + 16, columns?.getBoundingClientRect().top ?? bottom + 16);
    const height = `${Math.max(180, window.innerHeight - start - 16)}px`;
    aside.style.setProperty('--article-rail-height', height);
    get<HTMLElement>('doc-ltoc-aside')?.style.setProperty('--article-rail-height', height);
  };
  place();
  if (header) {
    const observer = new ResizeObserver(place);
    observer.observe(header);
    document.addEventListener('astro:before-swap', () => observer.disconnect(), { once: true });
  }
  window.addEventListener('resize', place);
  document.addEventListener('astro:before-swap', () => window.removeEventListener('resize', place), { once: true });
  applyRightAuto();
}

export function setupArticleDetailRails(): void {
  setupDirectoryTitles();
  setupLeft();
  setupRight();
  if (resizeBound) return;
  resizeBound = true;
  document.addEventListener('keydown', (event) => {
    // A foreground editor/settings/search dialog owns its keyboard interaction.
    if (document.querySelector('dialog[open], [role="dialog"][data-state="open"]')) return;
    const aside = get<HTMLElement>('doc-toc-aside');
    if (event.key === 'Escape' && aside?.dataset.collapsed === 'false') {
      applyRight(true, aside.dataset.auto !== 'true');
    }
    if (event.key === 'Tab' && aside?.dataset.auto === 'true' && aside.dataset.collapsed === 'false') {
      const controls = [...(get<HTMLElement>('doc-toc-panel')?.querySelectorAll<HTMLElement>('a,button,[tabindex="0"]') ?? [])]
        .filter(control => control.getClientRects().length && !control.closest('[inert]'));
      const first = controls[0], last = controls.at(-1);
      if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }
  });
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyRightAuto, 120);
  });
}
