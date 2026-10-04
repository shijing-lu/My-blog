/** Only the hovered/focused picker handles paste; text fields keep normal paste. */
export function bindImagePaste(zone: HTMLElement, onFiles: (files: File[]) => void): () => void {
  const doc = zone.ownerDocument;
  let hovered = false;
  const enter = () => { hovered = true; };
  const leave = () => { hovered = false; };
  zone.addEventListener('pointerenter', enter);
  zone.addEventListener('pointerleave', leave);
  const onPaste = (event: ClipboardEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    if (!hovered && !zone.contains(doc.activeElement)) return;
    const data = event.clipboardData;
    if (!data) return;
    const items = Array.from(data.items ?? []);
    const images = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    // Some browsers expose file data through files instead of items.
    const files = images.length ? images : Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length) event.preventDefault();
    onFiles(files);
  };
  doc.addEventListener('paste', onPaste);
  return () => {
    doc.removeEventListener('paste', onPaste);
    zone.removeEventListener('pointerenter', enter);
    zone.removeEventListener('pointerleave', leave);
  };
}
