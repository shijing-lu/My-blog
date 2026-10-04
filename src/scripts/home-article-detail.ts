/** 首页文章：共用文章详情骨架的目录、编辑与 TOC 命令适配器。 */
import { buildDocTree, renderDocTree, type DocTreeItem } from '@/lib/doc-tree-render';
import { installTreeContextMenu, type TreeCommand, type TreeTarget } from '@/lib/tree-context-menu';
import { setupArticleDetailRails } from '@/lib/article-detail-rails';
import { renderTocTreeHtml } from '@/lib/toc-tree';
import { confirmDanger } from '@/lib/confirm';
import { enhanceBodyHeadings, revealBodyHeading } from '@/lib/body-heading-folding';

const VIRTUAL_ROOT = '__home_uncategorized__';
const data = (): HTMLElement | null => document.getElementById('doc-detail-data');
const readNodes = (): DocTreeItem[] => JSON.parse(data()?.dataset.nodes ?? '[]') as DocTreeItem[];
const writeNodes = (nodes: DocTreeItem[]): void => { if (data()) data()!.dataset.nodes = JSON.stringify(nodes); };
const activeId = (): string => data()?.dataset.activeNode ?? '';
const editing = (): boolean => document.getElementById('doc-3col')?.dataset.editing === 'true';

function renderTree(): void {
  const root = document.querySelector<HTMLElement>('[data-doc-tree-root]');
  if (!root) return;
  const closed = new Set([...root.querySelectorAll<HTMLDetailsElement>('details[data-folder]')].filter((item) => !item.open).map((item) => item.dataset.folder));
  root.innerHTML = renderDocTree(buildDocTree(readNodes()), {
    authed: true, bundleId: '', activeId: activeId(), articlePath: 'home', virtualRootId: VIRTUAL_ROOT,
  });
  root.querySelectorAll<HTMLDetailsElement>('details[data-folder]').forEach((item) => { if (closed.has(item.dataset.folder)) item.open = false; });
  const breadcrumb = document.getElementById('home-folder-breadcrumb');
  if (breadcrumb) {
    const nodes = readNodes();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let parent: string | null = byId.get(activeId())?.parentId ?? VIRTUAL_ROOT;
    const path: string[] = [];
    const seen = new Set<string>();
    while (parent && parent !== VIRTUAL_ROOT && !seen.has(parent)) {
      seen.add(parent);
      const folder = byId.get(parent);
      if (!folder) break;
      path.unshift(folder.title);
      parent = folder.parentId;
    }
    breadcrumb.replaceChildren();
    for (const part of path.length ? path : ['未分类']) {
      const slash = document.createElement('span');
      slash.className = 'mx-1';
      slash.textContent = '/';
      const label = document.createElement('span');
      label.textContent = part;
      breadcrumb.append(slash, label);
    }
  }
}

function askFolderName(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.getElementById('home-folder-dialog') as HTMLDialogElement | null;
    const input = document.getElementById('home-folder-name') as HTMLInputElement | null;
    const error = document.getElementById('home-folder-error');
    const save = document.getElementById('home-folder-save');
    const cancel = document.getElementById('home-folder-cancel');
    if (!dialog || !input || !save || !cancel) { resolve(null); return; }
    document.getElementById('home-folder-dialog-title')!.textContent = title;
    input.value = initial;
    error?.classList.add('hidden');
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      save.removeEventListener('click', onSave);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onSave = (): void => {
      const value = input.value.trim();
      if (!value) { if (error) { error.textContent = '请填写目录名称'; error.classList.remove('hidden'); } return; }
      finish(value);
    };
    const onCancel = (): void => finish(null);
    const onClose = (): void => finish(null);
    save.addEventListener('click', onSave);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    input.focus();
  });
}

async function command(name: TreeCommand, target: TreeTarget): Promise<void> {
  const parentId = target.kind === 'folder' ? target.id : null;
  if (name === 'create-article') {
    const buttons = document.querySelectorAll<HTMLButtonElement>('#home-create-article, #doc-add-root-article');
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentId }) });
      const result = await response.json();
      if (!response.ok || !result.id) throw new Error(result.error || '创建文章失败');
      window.location.href = `/edit/${encodeURIComponent(result.id)}?edit=1`;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '创建文章失败');
      buttons.forEach(button => { button.disabled = false; });
    }
    return;
  }
  if (name === 'create-folder') {
    const title = await askFolderName('新建目录');
    if (!title) return;
    const res = await fetch('/api/article-categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: title, parentId }) });
    const result = await res.json();
    if (!res.ok || !result.category) { window.alert(result.error ?? '目录创建失败'); return; }
    writeNodes([...readNodes(), { id: result.category.id, parentId, kind: 'folder', title, sort: result.category.sort }]);
    renderTree();
    return;
  }
  if (!target.id) return;
  if (name === 'edit' && target.kind === 'article') {
    if (target.id === activeId()) window.__docInlineEditor?.open();
    else window.location.href = `/edit/${encodeURIComponent(target.id)}?edit=1`;
    return;
  }
  if (name === 'edit') {
    const title = await askFolderName('编辑目录', target.title);
    if (!title || title === target.title) return;
    const res = await fetch('/api/article-categories', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: target.id, name: title }) });
    if (!res.ok) { window.alert('目录保存失败'); return; }
    writeNodes(readNodes().map((node) => node.id === target.id ? { ...node, title } : node));
    renderTree();
    return;
  }
  const nodes = readNodes();
  const directArticles = nodes.filter((node) => node.kind === 'article' && node.parentId === target.id).length;
  const childFolders = nodes.filter((node) => node.kind === 'folder' && node.parentId === target.id).length;
  const message = target.kind === 'folder'
    ? `删除目录「${target.title}」？${directArticles} 篇直属文章会移到“未分类”，${childFolders} 个子目录会提升一级；文章不会被删除。`
    : `确定删除文章「${target.title}」？`;
  if (!(await confirmDanger(message))) return;
  if (target.kind === 'folder') {
    const res = await fetch('/api/article-categories', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: target.id }) });
    if (!res.ok) { window.alert('目录删除失败'); return; }
    const parent = nodes.find((node) => node.id === target.id)?.parentId ?? null;
    writeNodes(nodes.filter((node) => node.id !== target.id).map((node) => node.parentId === target.id ? { ...node, parentId: node.kind === 'folder' ? parent : VIRTUAL_ROOT } : node));
    renderTree();
  } else {
    const res = await fetch(`/api/articles/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
    if (!res.ok) { window.alert('文章删除失败'); return; }
    const remaining = nodes.filter((node) => node.id !== target.id);
    writeNodes(remaining);
    renderTree();
    if (target.id === activeId()) {
      const next = remaining.find((node) => node.kind === 'article');
      window.location.href = next ? `/edit/${encodeURIComponent(next.id)}` : '/admin';
    }
  }
}

function setup(): void {
  if (!document.querySelector('[data-article-domain="home"]')) return;
  setupArticleDetailRails();
  const editorGrid = document.getElementById('doc-3col');
  if (editorGrid && editorGrid.dataset.homeEditorFocusBound !== '1') {
    editorGrid.dataset.homeEditorFocusBound = '1';
    const focusVisibleEditor = (): void => {
      if (!editing()) return;
      requestAnimationFrame(() => {
        if (!editing()) return;
        document.querySelector<HTMLElement>('.doc-ie-view .cm-content')?.focus({ preventScroll: true });
      });
    };
    const editorObserver = new MutationObserver(focusVisibleEditor);
    editorObserver.observe(editorGrid, { attributes: true, attributeFilter: ['data-editing'] });
    document.addEventListener('astro:before-swap', () => editorObserver.disconnect(), { once: true });
    focusVisibleEditor();
  }
  const tree = document.getElementById('doc-ltoc-inner');
  if (tree && tree.dataset.homeMenuBound !== '1') {
    tree.dataset.homeMenuBound = '1';
    installTreeContextMenu(tree, command);
  }
  const rootFolder = document.getElementById('doc-add-root-folder');
  if (rootFolder && !rootFolder.dataset.bound) {
    rootFolder.dataset.bound = '1';
    rootFolder.addEventListener('click', () => void command('create-folder', { id: null, kind: 'root', title: '' }));
  }
  const rootArticle = document.getElementById('doc-add-root-article');
  if (rootArticle && !rootArticle.dataset.bound) {
    rootArticle.dataset.bound = '1';
    rootArticle.addEventListener('click', () => void command('create-article', { id: null, kind: 'root', title: '' }));
  }
  const newArticle = document.getElementById('home-create-article');
  if (newArticle && !newArticle.dataset.bound) {
    newArticle.dataset.bound = '1';
    newArticle.addEventListener('click', () => void command('create-article', { id: newArticle.dataset.parent || null, kind: newArticle.dataset.parent ? 'folder' : 'root', title: '' }));
  }
  const edit = document.getElementById('doc-inline-edit');
  if (edit && !edit.dataset.bound) {
    edit.dataset.bound = '1';
    edit.addEventListener('click', () => {
      if (editing()) window.__docInlineEditor?.saveAndClose?.();
      else window.__docInlineEditor?.open();
    });
  }
  const toc = document.getElementById('doc-toc-rail');
  if (toc && !toc.dataset.bound) {
    toc.dataset.bound = '1';
    toc.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const fold = target.closest<HTMLButtonElement>('.toc-fold');
      if (fold) {
        const node = fold.closest<HTMLElement>('.toc-node');
        node?.classList.toggle('folded');
        fold.setAttribute('aria-expanded', String(!node?.classList.contains('folded')));
        return;
      }
      const link = target.closest<HTMLAnchorElement>('a[data-doc-anchor]');
      if (!link) return;
      event.preventDefault();
      if (editing()) {
        const level = Number(link.className.match(/toc-l(\d)/)?.[1] ?? 2);
        const sameLevel = toc.querySelectorAll(`a.toc-l${level}`);
        const nth = [...sameLevel].indexOf(link);
        if (nth >= 0) window.__docInlineEditor?.jumpToHeading?.(level, nth);
      } else {
        const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        if (heading) { revealBodyHeading(heading); heading.scrollIntoView({ behavior: 'instant', block: 'start' }); }
      }
    });
  }
  const deferred = document.querySelector<HTMLElement>('article[data-defer-article]');
  if (deferred && !deferred.dataset.loading) {
    deferred.dataset.loading = '1';
    const id = deferred.dataset.deferArticle;
    if (id) void fetch(`/api/articles/${encodeURIComponent(id)}/render`).then((response) => response.json()).then((result) => {
      if (result.html && deferred.isConnected) {
        deferred.innerHTML = result.html;
        enhanceBodyHeadings(deferred);
        document.dispatchEvent(new CustomEvent('article:body-updated'));
      }
      const list = document.getElementById('doc-toc-list');
      if (list && Array.isArray(result.toc)) list.innerHTML = result.toc.length ? renderTocTreeHtml(result.toc) : '<p class="mt-2 text-xs text-muted-foreground">无目录</p>';
    }).catch(() => { deferred.textContent = '文章加载失败，请刷新重试。'; });
  }
  if (new URL(location.href).searchParams.get('edit') === '1') {
    const url = new URL(location.href);
    url.searchParams.delete('edit');
    history.replaceState(history.state, '', url);
    let attempts = 0;
    const open = (): void => {
      if (window.__docInlineEditor) window.__docInlineEditor.open();
      else if (attempts++ < 80) window.setTimeout(open, 100);
    };
    open();
  }
}

document.addEventListener('article-title-saved', (event) => {
  if (!document.querySelector('[data-article-domain="home"]')) return;
  const { id, title } = (event as CustomEvent<{ id: string; title: string }>).detail;
  writeNodes(readNodes().map((node) => node.id === id ? { ...node, title } : node));
  renderTree();
});
setup();
document.addEventListener('astro:page-load', setup);
