/**
 * 图片灯箱（原生 JS，无依赖）
 *
 * document 级事件委托：点击任意 [data-lightbox] 图片进入灯箱，
 * View Transitions 后无需重绑；支持 ESC / 点击遮罩关闭、←/→ 切换。
 *
 * ## 分组（`:::grid` 图片画廊网格）
 *
 * 灯箱导航范围**严格限制在同一网格容器内**：分组即「最近的 `.md-grid` 祖先」，
 * 无祖先的普通正文图片统一归入默认分组（行为与从前一致：全文档可切换）。
 * 用 DOM 祖先判定而非组件注入分组属性，可让 Grid 与 LightboxImage 互不引用
 * （避免组件间循环依赖）。
 *
 * ## 触屏
 *
 * 记录 touchstart/touchend 的横向位移，超过阈值即切换上一张/下一张。
 */

import { feedback, reducedMotion, cancelMotion } from '@/lib/motion';

let dismissCurrent: (() => void) | undefined;

interface LightboxItem {
  src: string;
  caption: string;
  el: HTMLElement;
}

/** 取某图片所属的网格容器（无则 null = 默认分组） */
function gridOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('.md-grid');
}

/** 收集同一分组的所有灯箱项（保持文档顺序） */
function collectItems(grid: HTMLElement | null): LightboxItem[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-lightbox]'))
    .filter((fig) => gridOf(fig) === grid)
    .map((fig) => {
      const img = fig.querySelector('img');
      return {
        src: fig.getAttribute('data-full-src') || img?.getAttribute('src') || '',
        caption: fig.getAttribute('data-caption') ?? img?.alt ?? '',
        el: fig,
      };
    });
}

function openLightbox(items: LightboxItem[], index: number, trigger: HTMLElement): void {
  if (!items.length) return;
  dismissCurrent?.();
  const single = items.length <= 1;
  const overlay = document.createElement('dialog');
  overlay.className = 'lightbox-overlay';
  if (trigger.closest('.neo-gallery-workspace')) overlay.classList.add('neo-gallery-lightbox');
  overlay.setAttribute('aria-label', '图片预览');
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="关闭">&times;</button>
    ${single ? '' : '<button class="lightbox-prev" type="button" aria-label="上一张">&#8249;</button>'}
    <figure class="lightbox-view">
      <img alt="" />
      <figcaption></figcaption>
    </figure>
    ${single ? '' : '<button class="lightbox-next" type="button" aria-label="下一张">&#8250;</button>'}
    ${single ? '' : '<span class="lightbox-count" aria-live="polite"></span>'}
  `;
  document.body.appendChild(overlay);

  const img = overlay.querySelector<HTMLImageElement>('.lightbox-view img');
  const caption = overlay.querySelector<HTMLElement>('.lightbox-view figcaption');
  const counter = overlay.querySelector<HTMLElement>('.lightbox-count');
  let current = index;
  let closed = false;
  const previousOverflow = document.body.style.overflow;
  const ownerBody = document.body;

  const render = (): void => {
    if (!img || !caption) return;
    const item = items[current];
    if (!item) return;
    img.src = item.src;
    img.alt = item.caption;
    caption.textContent = item.caption;
    if (counter) counter.textContent = `${current + 1} / ${items.length}`;
  };

  const close = (restoreFocus = true, animate = true): void => {
    if (closed) return;
    closed = true;
    if (img) cancelMotion(img);
    overlay.close();
    ownerBody.style.overflow = previousOverflow;
    document.removeEventListener('astro:before-swap', onNavigate);
    if (dismissCurrent === dismiss) dismissCurrent = undefined;
    // close() 已同步释放原生焦点锁；支持 display 离散过渡的浏览器显示短暂退出。
    if (animate && !reducedMotion()) window.setTimeout(() => overlay.remove(), 200);
    else overlay.remove();
    // 焦点回归到触发图片，键盘用户不丢失位置
    if (restoreFocus && trigger.isConnected) trigger.focus?.({ preventScroll: true });
  };
  const dismiss = (): void => close(false, false);
  const onNavigate = (): void => close(false, false);
  dismissCurrent = dismiss;
  document.addEventListener('astro:before-swap', onNavigate);
  const go = (delta: number): void => {
    if (items.length <= 1) return;
    current = (current + delta + items.length) % items.length;
    render();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  overlay.querySelector('.lightbox-close')?.addEventListener('click', () => close());
  overlay.querySelector('.lightbox-prev')?.addEventListener('click', () => go(-1));
  overlay.querySelector('.lightbox-next')?.addEventListener('click', () => go(1));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener('keydown', onKey);
  overlay.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  img?.addEventListener('load', () => { if (!closed) void feedback(img, 'change'); });

  // 触屏左右滑动切换
  let touchStartX: number | null = null;
  overlay.addEventListener(
    'touchstart',
    (e) => {
      touchStartX = e.changedTouches[0]?.clientX ?? null;
    },
    { passive: true },
  );
  overlay.addEventListener(
    'touchend',
    (e) => {
      if (touchStartX === null) return;
      const endX = e.changedTouches[0]?.clientX ?? touchStartX;
      const dx = endX - touchStartX;
      touchStartX = null;
      if (Math.abs(dx) < 40) return;
      go(dx > 0 ? -1 : 1);
    },
    { passive: true },
  );

  render();
  overlay.showModal();
  (overlay.querySelector('.lightbox-close') as HTMLButtonElement | null)?.focus();
  document.body.style.overflow = 'hidden';
}

document.addEventListener('click', (e) => {
  const fig = (e.target as HTMLElement).closest<HTMLElement>('[data-lightbox]');
  if (!fig) return;
  e.preventDefault();
  // 只在被点击图片所属网格内导航（.md-grid 容器 = 独立分组）
  const items = collectItems(gridOf(fig));
  const index = items.findIndex((it) => it.el === fig);
  openLightbox(items, index < 0 ? 0 : index, fig);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (!(event.target instanceof HTMLElement) || !event.target.matches('[data-lightbox]')) return;
  event.preventDefault();
  event.target.click();
});
