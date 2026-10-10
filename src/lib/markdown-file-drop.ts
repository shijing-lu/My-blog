import { DOC_IMPORT_MAX_BYTES, DOC_IMPORT_MAX_FILES, markdownFilename } from './doc-import-limits';
import type { DocTreeItem } from './doc-tree-render';
import '@/styles/markdown-file-drop.css';

interface DropTarget { element: HTMLElement; parentId: string | null; title: string }
interface Options {
  nodes: () => DocTreeItem[];
  endpoint: string;
  bundleId?: string;
  virtualRootId?: string;
  rootLabel: string;
  onImported: (node: DocTreeItem) => void;
}
type Phase = 'waiting' | 'uploading' | 'saving' | 'success' | 'error' | 'cancelled';
interface Job { file: File; id: string; phase: Phase; percent: number; error?: string }
const bound = new WeakMap<HTMLElement, () => void>();
function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const externalFiles = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes('Files');

/** One upload queue/UI, adapted to document folders or homepage article categories. */
export function installMarkdownFileDrop(container: HTMLElement, options: Options): () => void {
  if (bound.has(container)) return bound.get(container)!;
  let highlight: HTMLElement | null = null;
  let dialog: HTMLDialogElement | null = null;
  let jobs: Job[] = [];
  let target: DropTarget | null = null;
  let running = false, stop = false, disposed = false;
  let request: XMLHttpRequest | null = null;

  const clear = (): void => { highlight?.classList.remove('markdown-file-drop-target'); highlight = null; };
  const resolve = (element: EventTarget | null): DropTarget => {
    const node = element instanceof Element ? element : container;
    const folder = node.closest<HTMLElement>('[data-doc-folder-target]');
    const article = node.closest<HTMLElement>('[data-doc-node-id]');
    let parentId = folder?.dataset.docFolderTarget ?? (article ? options.nodes().find(item => item.id === article.dataset.docNodeId)?.parentId : null) ?? null;
    if (parentId === options.virtualRootId) parentId = null;
    return { element: folder ?? article ?? container, parentId,
      title: parentId ? options.nodes().find(item => item.id === parentId)?.title ?? options.rootLabel : options.rootLabel };
  };
  const render = (): void => {
    if (!dialog?.isConnected) return;
    dialog.querySelector<HTMLElement>('[data-import-target]')!.textContent = `导入到：${target?.title ?? ''}`;
    const success = jobs.filter(job => job.phase === 'success').length;
    const errors = jobs.filter(job => job.phase === 'error').length;
    const status = dialog.querySelector<HTMLElement>('[data-import-status]')!;
    status.textContent = `${running ? '处理中' : '已完成'} · 成功 ${success} / ${jobs.length} · 失败 ${errors}${stop ? ' · 已停止后续文件' : ''}`;
    const list = dialog.querySelector<HTMLElement>('[data-import-files]')!;
    for (const [index, job] of jobs.entries()) {
      const row = list.children[index] as HTMLElement;
      const label = row.querySelector<HTMLElement>('[data-file-status]')!;
      label.textContent = job.phase === 'uploading' ? `上传中 ${Math.round(job.percent)}%` : job.phase === 'saving' ? '上传完成，正在保存…'
        : job.phase === 'success' ? '已导入' : job.phase === 'error' ? job.error ?? '失败' : job.phase === 'cancelled' ? '已停止' : '等待上传';
      label.classList.toggle('text-destructive', job.phase === 'error');
      const progress = row.querySelector<HTMLProgressElement>('progress')!;
      progress.value = job.phase === 'success' || job.phase === 'saving' ? 100 : job.percent;
      progress.hidden = job.phase !== 'uploading' && job.phase !== 'saving';
    }
    const retry = dialog.querySelector<HTMLButtonElement>('[data-import-retry]')!;
    retry.hidden = running || !jobs.some(job => job.phase === 'error' || job.phase === 'cancelled');
    const close = dialog.querySelector<HTMLButtonElement>('[data-import-close]')!;
    close.textContent = running ? stop ? '等待当前文件保存…' : '停止后续文件' : '关闭';
    close.disabled = running && stop;
  };
  const upload = (job: Job): Promise<DocTreeItem> => new Promise((resolveUpload, reject) => {
    const params = new URLSearchParams({ filename: job.file.name, operationId: job.id, parentId: target?.parentId ?? '' });
    if (options.bundleId) params.set('bundleId', options.bundleId);
    const xhr = new XMLHttpRequest(); request = xhr;
    xhr.open('POST', `${options.endpoint}?${params}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.timeout = 120000;
    xhr.upload.onprogress = event => { job.percent = Math.min(100, event.loaded / Math.max(1, event.total || job.file.size) * 100); render(); };
    xhr.upload.onload = () => { job.phase = 'saving'; render(); };
    xhr.onload = () => {
      let data: { node?: DocTreeItem; error?: string };
      try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('服务器响应无效，请重试')); return; }
      if (xhr.status < 200 || xhr.status >= 300 || !data.node?.id) reject(new Error(data.error ?? '保存失败，请重试'));
      else resolveUpload(data.node);
    };
    xhr.onerror = () => reject(new Error('网络连接失败，可重试未完成文件'));
    xhr.ontimeout = () => reject(new Error('请求超时，可重试；已保存文件不会重复创建'));
    xhr.onabort = () => reject(new Error('上传已中断'));
    xhr.send(job.file);
  });
  const run = async (): Promise<void> => {
    if (running || disposed) return;
    running = true; stop = false; render();
    try {
      for (const job of jobs) {
        if (job.phase === 'success') continue;
        if (stop || disposed) { job.phase = 'cancelled'; continue; }
        job.error = undefined; job.percent = 0;
        if (!markdownFilename(job.file.name)) { job.phase = 'error'; job.error = '仅支持 .md / .markdown 文件'; render(); continue; }
        if (job.file.size > DOC_IMPORT_MAX_BYTES) { job.phase = 'error'; job.error = '文件不能超过 2 MiB'; render(); continue; }
        job.phase = 'uploading'; render();
        try {
          const node = await upload(job);
          job.phase = 'success'; job.percent = 100;
          if (!disposed && container.isConnected) options.onImported(node);
        } catch (error) { job.phase = 'error'; job.error = error instanceof Error ? error.message : '导入失败'; }
        finally { request = null; render(); }
      }
    } finally { running = false; render(); }
  };
  const open = (): void => {
    dialog?.remove();
    dialog = document.createElement('dialog');
    dialog.className = 'markdown-import-dialog m-auto w-[min(92vw,30rem)] rounded-lg border border-border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/40';
    dialog.setAttribute('aria-label', 'Markdown 导入进度');
    dialog.innerHTML = '<h3 class="font-medium">导入 Markdown</h3><p data-import-target class="mt-1 text-xs text-muted-foreground"></p><p data-import-status role="status" aria-live="polite" class="mt-3 text-sm"></p><ul data-import-files class="mt-3 max-h-72 space-y-3 overflow-y-auto"></ul><p class="mt-3 text-xs text-muted-foreground">只导入 Markdown，文件中的本地图片和附件需要另行上传。</p><div class="mt-4 flex justify-end gap-2"><button type="button" data-import-retry class="rounded-md border border-border px-3 py-1.5 text-sm">重试未完成</button><button type="button" data-import-close class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">关闭</button></div>';
    const list = dialog.querySelector<HTMLElement>('[data-import-files]')!;
    for (const job of jobs) {
      const row = document.createElement('li'); row.className = 'min-w-0 rounded-md border border-border px-3 py-2 text-sm';
      const name = document.createElement('p'); name.className = 'break-words'; name.textContent = job.file.name;
      const state = document.createElement('p'); state.dataset.fileStatus = ''; state.className = 'mt-1 text-xs text-muted-foreground break-words';
      const progress = document.createElement('progress'); progress.max = 100; progress.className = 'mt-2 w-full';
      row.append(name, state, progress); list.append(row);
    }
    const close = (): void => { if (running) { stop = true; render(); } else dialog?.close(); };
    dialog.querySelector('[data-import-close]')!.addEventListener('click', close);
    dialog.querySelector('[data-import-retry]')!.addEventListener('click', () => void run());
    dialog.addEventListener('cancel', event => { if (running) { event.preventDefault(); close(); } });
    document.body.append(dialog); dialog.showModal(); render();
  };
  const over = (event: DragEvent): void => {
    if (!externalFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = running ? 'none' : 'copy';
    if (running) return;
    const next = resolve(event.target); clear(); highlight = next.element; highlight.classList.add('markdown-file-drop-target');
  };
  const leave = (event: DragEvent): void => { if (!(event.relatedTarget instanceof Node) || !container.contains(event.relatedTarget)) clear(); };
  const drop = (event: DragEvent): void => {
    if (!externalFiles(event)) return;
    event.preventDefault(); event.stopPropagation(); clear();
    if (running) return;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    if (files.length > DOC_IMPORT_MAX_FILES) { window.alert(`一次最多导入 ${DOC_IMPORT_MAX_FILES} 个文件，请分批拖入。`); return; }
    target = resolve(event.target);
    jobs = files.map(file => ({ file, id: uuid(), phase: 'waiting', percent: 0 }));
    open(); void run();
  };
  const beforeUnload = (event: BeforeUnloadEvent): void => { if (running) event.preventDefault(); };
  const cleanup = (): void => {
    disposed = true; stop = true; request?.abort(); clear(); dialog?.remove();
    container.removeEventListener('dragover', over); container.removeEventListener('dragleave', leave); container.removeEventListener('drop', drop);
    window.removeEventListener('beforeunload', beforeUnload); bound.delete(container);
  };
  container.addEventListener('dragover', over); container.addEventListener('dragleave', leave); container.addEventListener('drop', drop);
  window.addEventListener('beforeunload', beforeUnload);
  bound.set(container, cleanup); return cleanup;
}
