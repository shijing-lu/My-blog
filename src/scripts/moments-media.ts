/** Scoped failure feedback for SSR cards and asynchronously inserted Moments cards. */
function showMediaFailure(image: HTMLImageElement): void {
  const figure = image.closest<HTMLElement>('.neo-moments .moment-media');
  if (!figure || figure.dataset.mediaFailed) return;
  figure.dataset.mediaFailed = 'true';
  figure.removeAttribute('data-lightbox');
  figure.removeAttribute('tabindex');
  figure.setAttribute('role', 'img');
  figure.setAttribute('aria-label', '图片暂时无法加载');
  image.hidden = true;
  const message = document.createElement('span');
  message.className = 'moment-media-failure';
  message.textContent = '图片暂时无法加载';
  figure.appendChild(message);
}
document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) showMediaFailure(event.target);
}, true);
document.addEventListener('astro:page-load', () => {
  document.querySelectorAll<HTMLImageElement>('.neo-moments .moment-media img').forEach(image => {
    if (image.complete && image.naturalWidth === 0) showMediaFailure(image);
  });
});
