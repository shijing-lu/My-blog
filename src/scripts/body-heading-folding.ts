import { initializeBodyHeadingFolding, revealBodyHeading } from '../lib/body-heading-folding';

function revealHash(): void {
  let id: string;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const target = id ? document.getElementById(id) : null;
  if (!target?.closest('article[data-heading-folding]')) return;
  revealBodyHeading(target);
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
}

function init(): void {
  initializeBodyHeadingFolding();
  if (location.hash) requestAnimationFrame(revealHash);
}

// Capture runs before page-specific TOC handlers measure the hidden target.
document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
  let id: string;
  try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (target?.closest('article[data-heading-folding]')) revealBodyHeading(target);
}, true);
window.addEventListener('hashchange', revealHash);
window.addEventListener('popstate', () => requestAnimationFrame(revealHash));
document.addEventListener('astro:page-load', init);
document.addEventListener('article:body-updated', init);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
