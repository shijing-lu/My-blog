import { EditorSelection, EditorState, StateField, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, drawSelection, keymap, placeholder } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, isolateHistory, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { mdKeymap } from './md-keymap';
import { columnBlocks, columnsEdit, columnsSource, columnsTransactionCache, pendingColumnFocus, setColumnTarget, setColumnsSource } from './cm-columns-state';
import { buildMarkdownColumns, removeMarkdownColumn, serializeMarkdownColumns } from '../../lib/markdown-columns';
import type { MarkdownColumns } from '../../lib/markdown-columns';
import { visualDirectivesExtension } from './cm-visual-directives';

interface Options { preview: Extension; onSave: () => void; onPaste: (event: ClipboardEvent) => boolean; onContextMenu?: (event: MouseEvent, child: EditorView, parent: EditorView) => boolean }
const controllers = new WeakMap<HTMLElement, ColumnController>();

function button(label: string, run: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); run(); });
  return element;
}

class ColumnController {
  editors: EditorView[] = [];
  block: MarkdownColumns;
  raw: string;
  disposed = false;
  syncing = false;
  private grid = document.createElement('div');
  private actions = document.createElement('div');
  constructor(readonly parent: EditorView, readonly dom: HTMLElement, block: MarkdownColumns, readonly options: Options) {
    this.block = block;
    this.raw = parent.state.sliceDoc(block.from, block.to);
    dom.className = 'cm-columns-widget';
    dom.contentEditable = 'false';
    dom.setAttribute('role', 'group');
    dom.setAttribute('aria-label', `${block.columns.length} 栏 Markdown`);
    this.actions.className = 'cm-columns-actions';
    this.grid.className = 'cm-columns-grid';
    dom.append(this.actions, this.grid);
    dom.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        this.flush();
        this.options.onSave();
      }
    }, true);
    this.mount();
  }

  private mount(): void {
    this.actions.replaceChildren(
      button('添加一栏', () => this.replace([...this.values(), ''], this.editors.length)),
      button('展开为普通正文', () => this.unwrap()),
      button('查看源码', () => {
        this.flush();
        this.parent.dispatch({ effects: setColumnsSource.of(true), selection: { anchor: this.block.from } });
        this.parent.focus();
      }),
    );
    (this.actions.firstElementChild as HTMLButtonElement).disabled = this.block.columns.length === 3;
    this.grid.dataset.columns = String(this.block.columns.length);
    this.block.columns.forEach((column, index) => {
      const pane = document.createElement('div');
      pane.className = 'cm-column-pane';
      const head = document.createElement('div');
      head.className = 'cm-column-head';
      const label = document.createElement('span');
      label.textContent = `第 ${index + 1} 栏`;
      head.append(label);
      const move = (direction: -1 | 1): void => {
        const values = this.values();
        const destination = index + direction;
        if (destination < 0 || destination >= values.length) return;
        [values[index], values[destination]] = [values[destination]!, values[index]!];
        this.replace(values, destination);
      };
      const left = button('左移', () => move(-1));
      const right = button('右移', () => move(1));
      left.disabled = index === 0;
      right.disabled = index === this.block.columns.length - 1;
      head.append(left, right);
      if (this.block.columns.length === 3) {
        const remove = button('合并移除', () => this.replace(removeMarkdownColumn(this.values(), index), Math.max(0, index - 1)));
        remove.title = '移除此栏，内容按阅读顺序合并到相邻栏';
        head.append(remove);
      }
      const host = document.createElement('div');
      host.className = 'cm-column-host';
      pane.append(head, host);
      this.grid.append(pane);
      const child: EditorView = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: column.content,
          extensions: [
            EditorView.lineWrapping, drawSelection(), markdown(), mdKeymap, this.options.preview, visualDirectivesExtension({
              onSave: this.options.onSave,
              onUndo: (redo) => this.history(redo),
              onContextMenu: this.options.onContextMenu,
            }),
            placeholder('在这里写 Markdown…'),
            EditorView.contentAttributes.of({ 'aria-label': `第 ${index + 1} 栏，共 ${this.block.columns.length} 栏` }),
            keymap.of([
              { key: 'Mod-z', run: () => this.history(false), shift: () => this.history(true) },
              { key: 'Mod-Shift-z', run: () => this.history(true) },
              { key: 'Mod-y', run: () => this.history(true) },
              { key: 'Mod-s', run: () => { this.options.onSave(); return true; } },
              { key: 'Tab', run: () => this.focusNeighbour(index, 1) },
              { key: 'Shift-Tab', run: () => this.focusNeighbour(index, -1) },
              { key: 'Escape', run: () => this.exit() },
              ...defaultKeymap,
            ]),
            EditorView.domEventHandlers({
              contextmenu: (event) => this.options.onContextMenu?.(event, child, this.parent) ?? false,
              focus: () => { setColumnTarget(this.parent, child); return false; },
              paste: (event) => { setColumnTarget(this.parent, child); return this.options.onPaste(event); },
              drop: (event) => {
                setColumnTarget(this.parent, child);
                const pos = child.posAtCoords({ x: event.clientX, y: event.clientY });
                if (pos !== null) child.dispatch({ selection: { anchor: pos } });
                return false;
              },
            }),
            EditorView.updateListener.of((update) => {
              if (this.syncing || this.disposed) return;
              if (update.docChanged) this.commitColumn(index, update.state.doc.toString(), update.state.selection);
              else if (update.selectionSet && child.hasFocus) this.syncSelection(index, update.state.selection);
            }),
            EditorView.theme({
              '&': { fontSize: 'inherit', backgroundColor: 'transparent', color: 'inherit', minHeight: '6rem' },
              '&.cm-focused': { outline: 'none' },
              '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.75', overflow: 'visible' },
              '.cm-content': { padding: '10px', minHeight: '6rem', caretColor: 'var(--color-foreground)' },
              '.cm-line': { padding: '0' },
              '.cm-cursor': { borderLeftColor: 'var(--color-foreground)' },
              '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 20%, transparent) !important' },
            }),
          ],
        }),
      });
      this.editors.push(child);
    });
    queueMicrotask(() => {
      const focus = pendingColumnFocus.get(this.parent);
      if (this.disposed || !focus || focus.pos !== this.block.from) return;
      pendingColumnFocus.delete(this.parent);
      this.focus(focus.column, focus.offset);
    });
  }

  private flush(): void {
    for (const table of this.dom.querySelectorAll('.md-table-widget')) table.dispatchEvent(new Event('md-editor-flush'));
  }
  private values(): string[] { this.flush(); return this.editors.map((editor) => editor.state.doc.toString()); }
  private current(): boolean {
    return !this.disposed && this.block.to <= this.parent.state.doc.length
      && this.parent.state.sliceDoc(this.block.from, this.block.to) === this.raw;
  }

  private commitColumn(index: number, content: string, selection: EditorSelection): void {
    if (!this.current()) return;
    const column = this.block.columns[index]!;
    const values = this.block.columns.map((item, at) => at === index ? content : item.content);
    const { source: normalized, block: next } = serializeMarkdownColumns(values);
    const owned = { ...next, from: this.block.from, to: this.block.from + next.to,
      columns: next.columns.map((item) => ({ ...item, from: this.block.from + item.from, to: this.block.from + item.to })) };
    const previous = buildMarkdownColumns(this.block.columns.map((item) => item.content));
    // Normalize hand-written framing once, and promote the outer fence when
    // a column acquires a nested directive or a literal directive code sample.
    if (previous !== this.raw || !normalized.startsWith(`${this.block.fence}columns\n`)) {
      const start = owned.columns[index]!.from;
      this.parent.dispatch({
        changes: { from: this.block.from, to: this.block.to, insert: normalized },
        selection: { anchor: start + selection.main.anchor, head: start + selection.main.head },
        userEvent: 'input.type',
        annotations: columnsEdit.of(owned),
      });
      return;
    }
    // Small source change: do not serialize all columns on every keypress.
    this.parent.dispatch({
      changes: { from: column.from, to: column.to, insert: content },
      selection: { anchor: column.from + selection.main.anchor, head: column.from + selection.main.head },
      userEvent: 'input.type',
      annotations: columnsEdit.of(owned),
    });
  }

  private syncSelection(index: number, selection: EditorSelection): void {
    if (!this.current()) return;
    const start = this.block.columns[index]!.from;
    this.parent.dispatch({
      selection: { anchor: start + selection.main.anchor, head: start + selection.main.head },
      annotations: Transaction.addToHistory.of(false),
    });
  }

  private replace(values: string[], focus: number): void {
    if (!this.current() || (values.length !== 2 && values.length !== 3)) return;
    const { source: text, block } = serializeMarkdownColumns(values);
    const owned = { ...block, from: this.block.from, to: this.block.from + block.to,
      columns: block.columns.map((column) => ({ ...column, from: this.block.from + column.from, to: this.block.from + column.to })) };
    pendingColumnFocus.set(this.parent, { pos: this.block.from, column: focus, offset: 0 });
    this.parent.dispatch({
      changes: { from: this.block.from, to: this.block.to, insert: text },
      selection: { anchor: this.block.from },
      annotations: [isolateHistory.of('full'), columnsEdit.of(owned)],
      userEvent: 'input.columns.structure',
    });
  }

  private unwrap(): void {
    const values = this.values();
    if (!this.current()) return;
    const from = this.block.from;
    this.parent.dispatch({
      changes: { from, to: this.block.to, insert: values.join('\n\n') },
      selection: { anchor: from }, annotations: isolateHistory.of('full'), userEvent: 'input.columns.unwrap',
    });
    this.parent.focus();
  }

  private history(forward: boolean): boolean {
    (forward ? redo : undo)(this.parent);
    return true;
  }

  private focusNeighbour(index: number, direction: number): boolean {
    const next = index + direction;
    if (next < 0 || next >= this.editors.length) return this.exit(direction < 0);
    this.focus(next, 0);
    return true;
  }

  private exit(before = false): boolean {
    const pos = before ? this.block.from : this.block.to;
    // Ensure a paragraph outside the block exists for continued writing.
    const needsLine = !before && pos === this.parent.state.doc.length;
    const needsStart = before && pos === 0;
    this.parent.dispatch({
      ...(needsLine || needsStart ? { changes: { from: pos, insert: '\n\n' } } : {}),
      selection: { anchor: before ? Math.max(0, pos - 1) : Math.min(this.parent.state.doc.length + (needsLine ? 2 : 0), pos + 1) },
    });
    setColumnTarget(this.parent);
    this.parent.focus();
    return true;
  }

  focus(index: number, offset: number): void {
    const child = this.editors[index];
    if (!child || this.disposed) return;
    child.dispatch({ selection: { anchor: Math.min(offset, child.state.doc.length) } });
    child.focus();
    setColumnTarget(this.parent, child);
  }

  sync(block: MarkdownColumns): boolean {
    if (block.columns.length !== this.editors.length) return false;
    this.block = block;
    this.raw = this.parent.state.sliceDoc(block.from, block.to);
    // Parent updates may be called by a child update listener. Defer reverse
    // synchronization until both EditorViews have finished their transactions.
    queueMicrotask(() => {
      if (this.disposed) return;
      this.syncing = true;
      try {
        this.block.columns.forEach((column, index) => {
          const child = this.editors[index]!;
          if (child.state.doc.toString() === column.content) return;
          const selection = this.parent.state.selection.main;
          const offset = selection.head >= column.from && selection.head <= column.to
            ? selection.head - column.from : Math.min(child.state.selection.main.head, column.content.length);
          child.dispatch({ changes: { from: 0, to: child.state.doc.length, insert: column.content }, selection: { anchor: offset } });
        });
      } finally { this.syncing = false; }
      const focus = pendingColumnFocus.get(this.parent);
      if (focus?.pos === this.block.from) {
        pendingColumnFocus.delete(this.parent);
        this.focus(focus.column, focus.offset);
      }
    });
    return true;
  }

  destroy(): void { this.disposed = true; for (const child of this.editors) child.destroy(); }
}

class ColumnsWidget extends WidgetType {
  constructor(readonly block: MarkdownColumns, readonly raw: string, readonly options: Options) { super(); }
  eq(other: ColumnsWidget): boolean { return this.raw === other.raw && this.block.from === other.block.from; }
  toDOM(parent: EditorView): HTMLElement {
    const dom = document.createElement('div');
    controllers.set(dom, new ColumnController(parent, dom, this.block, this.options));
    return dom;
  }
  updateDOM(dom: HTMLElement): boolean { return controllers.get(dom)?.sync(this.block) ?? false; }
  destroy(dom: HTMLElement): void { controllers.get(dom)?.destroy(); controllers.delete(dom); }
  ignoreEvent(): boolean { return true; }
}

export function columnsExtension(options: Options): Extension {
  const build = (state: EditorState): DecorationSet => state.field(columnsSource)
    ? Decoration.none
    : Decoration.set(columnBlocks(state.doc).map((block) => Decoration.replace({
      block: true, widget: new ColumnsWidget(block, state.sliceDoc(block.from, block.to), options),
    }).range(block.from, block.to)));
  const field = StateField.define<DecorationSet>({
    create: build,
    update: (value, transaction) => transaction.docChanged || transaction.effects.some((effect) => effect.is(setColumnsSource)) ? build(transaction.state) : value,
    provide: (field) => EditorView.decorations.from(field),
  });
  return [columnsTransactionCache, columnsSource, field];
}
