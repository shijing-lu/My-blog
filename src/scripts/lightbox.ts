/**
 * 图片灯箱（原生 JS，无依赖）
 *
 * document 级事件委托：点击任意 [data-lightbox] 图片进入灯箱，
 * View Transitions 后无需重绑；支持 ESC / 点击遮罩关闭、←/→ 切换。
 */

/** 收集全部灯箱图片源 */
function collectItems(): Array<{ src: string; caption: string }> {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-lightbox]')).map((fig) => {
    const img = fig.querySelector('img');
    return {
      src: img?.getAttribute('src') ?? '',
      caption: fig.getAttribute('data-caption') ?? img?.alt ?? '',
    };
  });
}

/** 构造并展示灯箱 */
function openLightbox(items: Array<{ src: string; caption: string }>, index: number): void {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="关闭">&times;</button>
    <button class="lightbox-prev" type="button" aria-label="上一张">&#8249;</button>
    <figure class="lightbox-view">
      <img alt="" />
      <figcaption></figcaption>
    </figure>
    <button class="lightbox-next" type="button" aria-label="下一张">&#8250;</button>
  `;
  document.body.appendChild(overlay);

  const img = overlay.querySelector<HTMLImageElement>('.lightbox-view img');
  const caption = overlay.querySelector<HTMLElement>('.lightbox-view figcaption');
  let current = index;

  const render = (): void => {
    if (!img || !caption) return;
    const item = items[current];
    if (!item) return;
    img.src = item.src;
    img.alt = item.caption;
    caption.textContent = item.caption;
  };

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const go = (delta: number): void => {
    current = (current + delta + items.length) % items.length;
    render();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  };

  overlay.querySelector('.lightbox-close')?.addEventListener('click', close);
  overlay.querySelector('.lightbox-prev')?.addEventListener('click', () => go(-1));
  overlay.querySelector('.lightbox-next')?.addEventListener('click', () => go(1));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  render();
  (overlay.querySelector('.lightbox-close') as HTMLButtonElement | null)?.focus();
  document.body.style.overflow = 'hidden';
  const restore = (): void => {
    document.body.style.overflow = '';
  };
  // 关闭后恢复滚动
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      restore();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

/** 文档级点击委托：打开对应图片的灯箱 */
document.addEventListener('click', (e) => {
  const fig = (e.target as HTMLElement).closest<HTMLElement>('[data-lightbox]');
  if (!fig) return;
  e.preventDefault();
  const items = collectItems();
  const index = Array.from(document.querySelectorAll<HTMLElement>('[data-lightbox]')).findIndex(
    (el) => el === fig,
  );
  openLightbox(items, index < 0 ? 0 : index);
});
