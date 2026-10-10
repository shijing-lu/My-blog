/** Static Lucide shapes for the isomorphic tree/card renderers (no React/Node dependency). */
const shapes = {
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  pencil: '<path d="m16 3 5 5-13 13H3v-5Z"/><path d="m14 5 5 5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
};
export function articleUiIcon(name: keyof typeof shapes): string {
  return `<svg class="article-ui-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
}
