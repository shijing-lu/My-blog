/** Preserve tree reorder: the small export grip alone starts a native file drag. */
type Prepared = { ok: boolean; token?: string; filename?: string; error?: string };
/** 桌面端主进程导出的能力桥；类型集中声明在这里（其余模块只读 `window.desktop`） */
declare global { interface Window { desktop?: {
  prepareMarkdownExport?: (id: string) => Promise<Prepared>;
  startMarkdownDrag?: (token: string) => void;
  /** PDF 直出：渲染层准备好正文后交由主进程 printToPDF 静默写文件（见 desktop/pdf-export.cjs） */
  exportPdf?: (input: { title: string }) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  [key: string]: unknown;
}; } }
function status(message: string): void {
  const element = document.getElementById('doc-create-status');
  if (element) { element.classList.remove('sr-only'); element.textContent = message; }
}
export async function downloadDocMarkdown(id: string): Promise<void> {
  if (document.getElementById('doc-detail-data')?.dataset.activeNode === id && window.__docInlineEditor && !(await window.__docInlineEditor.flush?.())) { status('保存失败，请先处理当前改动再导出'); return; }
  const link = document.createElement('a'); link.href = `/api/export/doc/${encodeURIComponent(id)}`; link.download = ''; link.click();
}
export function installMarkdownFileExport(root: HTMLElement): () => void {
  const controller = new AbortController(), { signal } = controller;
  let generation = 0;
  const ready = new Map<string, { token: string; expires: number }>();
  const preparing = new Map<string, Promise<void>>();
  const prepare = async (id: string): Promise<void> => {
    if (preparing.has(id)) return preparing.get(id);
    const run = generation;
    const task = (async () => {
      const desktop = window.desktop;
      if (!desktop?.prepareMarkdownExport) return;
      if (document.getElementById('doc-detail-data')?.dataset.activeNode === id && window.__docInlineEditor && !(await window.__docInlineEditor.flush?.())) throw Error('保存失败，请先处理当前改动再导出');
      const result = await desktop.prepareMarkdownExport(id);
      if (!result.ok || !result.token) throw Error(result.error || 'Markdown 导出准备失败');
      if (!signal.aborted && run === generation) ready.set(id, { token: result.token, expires: Date.now() + 90000 });
    })().catch(cause => { if (!signal.aborted) status(cause instanceof Error ? cause.message : '导出准备失败'); }).finally(() => preparing.delete(id));
    preparing.set(id, task); return task;
  };
  root.addEventListener('pointerover', event => {
    const grip = (event.target as Element).closest<HTMLElement>('[data-markdown-export-drag]');
    if (grip && !ready.has(grip.dataset.markdownExportDrag!)) void prepare(grip.dataset.markdownExportDrag!);
  }, { signal });
  root.addEventListener('focusin', event => { const grip = (event.target as Element).closest<HTMLElement>('[data-markdown-export-drag]'); if (grip) void prepare(grip.dataset.markdownExportDrag!); }, { signal });
  root.addEventListener('dragstart', event => {
    const grip = (event.target as Element).closest<HTMLElement>('[data-markdown-export-drag]');
    if (!grip) return;
    event.preventDefault(); event.stopPropagation();
    const id = grip.dataset.markdownExportDrag!, item = ready.get(id);
    if (window.desktop?.startMarkdownDrag && item && item.expires > Date.now()) { window.desktop.startMarkdownDrag(item.token); status('拖到桌面或文件夹即可导出 Markdown'); }
    else if (window.desktop?.prepareMarkdownExport) { ready.delete(id); status('正在准备 Markdown，请稍后重新拖动'); void prepare(id); }
    else status('浏览器请点击导出手柄或使用菜单中的“导出 Markdown”');
  }, { capture: true, signal });
  root.addEventListener('click', event => { const grip = (event.target as Element).closest<HTMLElement>('[data-markdown-export-drag]'); if (grip) { event.preventDefault(); event.stopPropagation(); void downloadDocMarkdown(grip.dataset.markdownExportDrag!); } }, { capture: true, signal });
  const invalidate = (): void => { generation++; ready.clear(); };
  document.addEventListener('input', invalidate, { capture: true, signal });
  document.addEventListener('article:body-updated', invalidate, { signal });
  return () => { controller.abort(); ready.clear(); };
}
