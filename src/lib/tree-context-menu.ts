/** 左侧文章目录的共用菜单；只处理呈现与输入，数据操作由页面适配器执行。 */
export type TreeTarget = { id: string | null; kind: 'root' | 'folder' | 'article'; title: string };
export type TreeCommand = 'create-article' | 'create-folder' | 'edit' | 'delete';

const COMMANDS: Record<TreeTarget['kind'], Array<{ id: TreeCommand; label: string }>> = {
  root: [{ id: 'create-article', label: '新建文章' }, { id: 'create-folder', label: '新建目录' }],
  folder: [
    { id: 'create-article', label: '在此新建文章' },
    { id: 'create-folder', label: '在此新建子目录' },
    { id: 'edit', label: '编辑目录' },
    { id: 'delete', label: '删除目录' },
  ],
  article: [{ id: 'edit', label: '编辑文章' }, { id: 'delete', label: '删除文章' }],
};

export function installTreeContextMenu(
  root: HTMLElement,
  onCommand: (command: TreeCommand, target: TreeTarget) => void | Promise<void>,
): () => void {
  const controller = new AbortController();
  const signal = controller.signal;
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '目录操作');
  menu.className = 'fixed z-[90] hidden min-w-40 max-h-[min(70vh,24rem)] overflow-y-auto rounded-lg border border-border bg-card p-1 text-sm text-foreground shadow-xl';
  document.body.append(menu);
  let current: TreeTarget | null = null;
  let returnFocus: HTMLElement | null = null;
  let longPress: number | undefined;
  let pressX = 0;
  let pressY = 0;
  let suppressClickUntil = 0;
  if (root.tabIndex < 0) root.tabIndex = -1;

  const close = (restoreFocus = false): void => {
    if (menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    if (restoreFocus) returnFocus?.focus({ preventScroll: true });
    current = null;
  };
  const targetAt = (node: EventTarget | null): { value: TreeTarget; focus: HTMLElement } | null => {
    const element = node instanceof Element ? node : null;
    if (!element || !root.contains(element)) return null;
    const row = element.closest<HTMLElement>('[data-tree-node-id]');
    if (row && root.contains(row)) {
      return {
        value: {
          id: row.dataset.treeNodeId ?? null,
          kind: row.dataset.treeNodeKind === 'folder' ? 'folder' : 'article',
          title: row.dataset.treeNodeTitle ?? '',
        },
        focus: row,
      };
    }
    return { value: { id: null, kind: 'root', title: '' }, focus: root };
  };
  const open = (x: number, y: number, source: ReturnType<typeof targetAt>): void => {
    if (!source) return;
    current = source.value;
    returnFocus = source.focus;
    menu.replaceChildren();
    for (const item of COMMANDS[current.kind]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.command = item.id;
      button.className = `block w-full rounded px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${item.id === 'delete' ? 'text-destructive' : ''}`;
      button.textContent = item.label;
      menu.append(button);
    }
    menu.classList.remove('hidden');
    menu.style.left = '0px';
    menu.style.top = '0px';
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  };

  root.addEventListener('contextmenu', (event) => {
    const source = targetAt(event.target);
    if (!source) return;
    event.preventDefault();
    open(event.clientX, event.clientY, source);
  }, { signal });
  root.addEventListener('click', (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-menu-trigger]');
    if (!trigger || !root.contains(trigger)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClickUntil = 0;
    const rect = trigger.getBoundingClientRect();
    open(rect.left, rect.bottom, targetAt(trigger));
  }, { signal, capture: true });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const source = targetAt(event.target);
    if (!source) return;
    event.preventDefault();
    const rect = source.focus.getBoundingClientRect();
    open(rect.left + Math.min(rect.width, 120), rect.bottom, source);
  }, { signal });
  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    const source = targetAt(event.target);
    if (!source) return;
    pressX = event.clientX;
    pressY = event.clientY;
    longPress = window.setTimeout(() => {
      suppressClickUntil = Date.now() + 800;
      open(pressX, pressY, source);
    }, 550);
  }, { signal });
  root.addEventListener('pointermove', (event) => {
    if (longPress !== undefined && Math.hypot(event.clientX - pressX, event.clientY - pressY) > 10) {
      window.clearTimeout(longPress);
      longPress = undefined;
    }
  }, { signal });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    root.addEventListener(type, () => {
      if (longPress !== undefined) window.clearTimeout(longPress);
      longPress = undefined;
    }, { signal });
  }
  root.addEventListener('click', (event) => {
    if (Date.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, signal });
  menu.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-command]');
    if (!button || !current) return;
    const command = button.dataset.command as TreeCommand;
    const target = current;
    close(true);
    void onCommand(command, target);
  }, { signal });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target as Node)) close();
  }, { signal });
  window.addEventListener('resize', () => close(), { signal });
  window.addEventListener('scroll', () => close(), { signal, capture: true });
  const cleanup = (): void => {
    controller.abort();
    if (longPress !== undefined) window.clearTimeout(longPress);
    menu.remove();
  };
  document.addEventListener('astro:before-swap', cleanup, { once: true, signal });
  return cleanup;
}
