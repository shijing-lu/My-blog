import { EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder } from '@codemirror/view';
import { searchKeymap } from '@codemirror/search';
import { searchFoldRestoration } from './cm-search-folds';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { livePreview } from './cm-live-preview';
import { scanVisualDirectives } from '../../lib/markdown-visual-directives';
import type { VisualBlock, VisualItem } from '../../lib/markdown-visual-directives';
import { columnBlocks, registerEditorOwner, rootEditor, setColumnTarget } from './cm-columns-state';
import { scanMarkdownCallouts } from '../../lib/markdown-callouts';
import { headingFolding, rememberChildHeadingFolds, restoreChildHeadingFolds, unfoldHeadingAt } from './cm-heading-folding';

export const setVisualSource = StateEffect.define<boolean>();
const visualSource = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => { for (const effect of tr.effects) if (effect.is(setVisualSource)) value = effect.value; return value; },
});

const controllers = new WeakMap<HTMLElement, VisualController>();
interface Options { childExtensions?: () => Extension; onPaste?: (event: ClipboardEvent) => boolean; foldHeadings?: boolean; onSave?: () => void; onUndo?: (redo: boolean) => boolean; onContextMenu?: (event: MouseEvent, child: EditorView, parent: EditorView) => boolean }
function button(label: string, run: () => void, title = label): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.title = title;
  node.addEventListener('mousedown', (event) => event.preventDefault());
  node.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); run(); });
  return node;
}
function input(value: string, label: string, update: (value: string) => void): HTMLInputElement {
  const node = document.createElement('input'); node.type = 'text'; node.value = value; node.setAttribute('aria-label', label);
  node.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); node.blur(); } event.stopPropagation(); });
  node.addEventListener('blur', () => { if (node.value !== value) update(node.value); });
  return node;
}
function select(values: Array<[string, string]>, value: string, label: string, change: (v: string) => void): HTMLSelectElement {
  const node = document.createElement('select'); node.setAttribute('aria-label', label);
  for (const [v, text] of values) { const option = document.createElement('option'); option.value = v; option.textContent = text; node.append(option); }
  node.value = value; node.addEventListener('change', () => change(node.value)); return node;
}
class VisualController {
  block: VisualBlock;
  raw: string;
  disposed = false;
  editing = false;
  active = 0;
  expanded = new Set<number>();
  children = new Map<number, EditorView>();
  private structure = '';
  constructor(readonly parent: EditorView, readonly dom: HTMLElement, block: VisualBlock, readonly options: Options) {
    this.block = block; this.raw = block.raw;
    this.active = Math.max(0, block.items.findIndex((item) => item.active));
    block.items.forEach((item, index) => { if (item.state === '+' || (block.expand && item.state !== '-')) this.expanded.add(index); });
    dom.contentEditable = 'false'; dom.className = `cm-visual-directive cm-visual-${block.kind}`;
    this.render();
  }
  private current(): boolean { return !this.disposed && this.parent.state.sliceDoc(this.block.from, this.block.to) === this.raw; }
  private replace(from: number, to: number, text: string, userEvent = 'input.visual-directive'): void {
    if (!this.current()) return;
    this.parent.dispatch({ changes: { from, to, insert: text }, userEvent });
  }
  private whole(source: string): void { this.replace(this.block.from, this.block.to, source); }
  private body(index: number, content: string): void {
    const item = this.block.items[index]; if (!item?.body) return;
    const text = this.block.kind === 'collapse' ? content.split('\n').map((line) => line ? `  ${line}` : '').join('\n') : content;
    this.replace(item.body.from, item.body.to, text, 'input.type');
  }
  private bodyContent(item: VisualItem): string {
    const text = item.body?.text ?? '';
    return this.block.kind === 'collapse' ? text.split('\n').map((line) => line.startsWith('  ') ? line.slice(2) : line).join('\n') : text;
  }
  private itemStart(index: number): number {
    const item = this.block.items[index]!;
    if (this.block.kind === 'tabs') return item.heading.from - (item.active ? '@tab:active '.length : '@tab '.length);
    if (this.block.kind === 'collapse') return item.heading.from - (item.state ? 5 : 2);
    return item.heading.from;
  }
  private move(index: number, direction: -1 | 1): void {
    const other = index + direction;
    if (other < 0 || other >= this.block.items.length || !this.current()) return;
    const first = Math.min(index, other), second = Math.max(index, other);
    const start = this.itemStart(first), mid = this.itemStart(second);
    const end = second + 1 < this.block.items.length ? this.itemStart(second + 1) : this.block.closing.from;
    const left = this.parent.state.sliceDoc(start, mid), right = this.parent.state.sliceDoc(mid, end);
    if (this.block.kind === 'tabs') this.active = other;
    this.replace(start, end, right + left);
  }
  private closeChildren(): void {
    for (const [index, child] of this.children) {
      rememberChildHeadingFolds(this.parent, `visual:${this.block.kind}:${this.block.from}:${index}`, child);
      child.destroy();
    }
    this.children.clear();
  }
  private mountBody(host: HTMLElement, index: number): void {
    if (this.children.has(index)) return;
    const item = this.block.items[index]; if (!item?.body) return;
    const child: EditorView = new EditorView({ parent: host, state: EditorState.create({
      doc: this.bodyContent(item), extensions: [EditorView.lineWrapping, markdown(), this.options.childExtensions?.() ?? livePreview(), searchFoldRestoration, placeholder('在这里写 Markdown…'),
        ...(this.options.foldHeadings ? [headingFolding()] : []),
        keymap.of([
          { key: 'Mod-s', run: () => { this.options.onSave?.(); return true; } },
          { key: 'Mod-z', run: () => this.options.onUndo?.(false) ?? undo(rootEditor(this.parent)), shift: () => this.options.onUndo?.(true) ?? redo(rootEditor(this.parent)) },
          { key: 'Mod-Shift-z', run: () => this.options.onUndo?.(true) ?? redo(rootEditor(this.parent)) },
          { key: 'Mod-y', run: () => this.options.onUndo?.(true) ?? redo(rootEditor(this.parent)) },
          ...defaultKeymap,
          ...searchKeymap,
        ]),
        EditorView.domEventHandlers({
          contextmenu: (event) => this.options.onContextMenu?.(event, child, this.parent) ?? false,
          focus: (event) => { if (event.target === child.contentDOM) { setColumnTarget(this.parent, child); setColumnTarget(child); } return false; },
          paste: (event) => { setColumnTarget(this.parent, child); return this.options.onPaste?.(event) ?? false; },
        }),
        EditorView.updateListener.of((update) => { if (this.editing || this.disposed || !update.docChanged) return; this.body(index, update.state.doc.toString()); }),
        EditorView.theme({ '&': { backgroundColor: 'transparent', fontSize: 'inherit' }, '&.cm-focused': { outline: 'none' }, '.cm-scroller': { fontFamily: 'inherit', overflow: 'visible' }, '.cm-content': { minHeight: '3rem', padding: '.5rem .25rem' }, '.cm-line': { padding: '0' } }),
      ],
    }) });
    registerEditorOwner(child, this.parent, () => {
      const body = this.block.items[index]!.body!, source = this.parent.state.doc.toString(), kind = this.block.kind;
      return content => source.slice(0, body.from) + (kind === 'collapse' ? content.split('\n').map(line => line ? `  ${line}` : '').join('\n') : content) + source.slice(body.to);
    });
    if (this.options.foldHeadings) restoreChildHeadingFolds(this.parent, `visual:${this.block.kind}:${this.block.from}:${index}`, child);
    this.children.set(index, child);
  }
  private controlBar(): HTMLElement {
    const bar = document.createElement('div'); bar.className = 'cm-visual-actions';
    const title = document.createElement('span'); title.textContent = this.block.kind === 'tabs' ? '选项卡组' : this.block.kind === 'grid' ? '图片画廊' : this.block.kind === 'admonition' ? '提示块' : '折叠面板';
    bar.append(title, button('查看源码', () => { this.parent.dispatch({ effects: setVisualSource.of(true), selection: { anchor: this.block.from } }); this.parent.focus(); }));
    return bar;
  }
  private renderTabs(): void {
    const container = document.createElement('div'); container.className = 'md-tabs';
    const nav = document.createElement('div'); nav.className = 'md-tabs-nav'; nav.setAttribute('role', 'tablist');
    this.block.items.forEach((item, index) => {
      const tab = button(item.heading.text, () => { this.active = index; this.render(); }, `切换到第 ${index + 1} 项`);
      tab.className = 'md-tabs-tab'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(index === this.active)); nav.append(tab);
    });
    const panel = document.createElement('div'); panel.className = 'md-tabs-panel'; panel.setAttribute('role', 'tabpanel');
    const head = document.createElement('div'); head.className = 'cm-visual-row';
    const selected = this.block.items[this.active]!;
    head.append(input(selected.heading.text, '选项卡标题', (value) => this.replace(selected.heading.from, selected.heading.to, value.trim() || selected.heading.text)));
    head.append(input(this.block.stableId ?? '', '同步组 ID', (value) => {
      if (/^[\w-]*$/.test(value)) this.replace(this.block.opening.from, this.block.opening.to, `:::tabs${value ? `#${value}` : ''}`);
    }));
    head.append(button(selected.active ? '默认项 ✓' : '设为默认', () => {
      let source = this.raw;
      const spans = this.block.items.map((item) => ({ from: item.heading.from - this.block.from, active: item.active }));
      for (let n = spans.length - 1; n >= 0; n--) {
        const span = spans[n]!; const prefix = span.active ? '@tab:active ' : '@tab ';
        source = source.slice(0, span.from - prefix.length) + (n === this.active ? '@tab:active ' : '@tab ') + source.slice(span.from);
      }
      this.whole(source);
    }));
    const add = button('添加选项卡', () => this.replace(this.block.closing.from, this.block.closing.from, `@tab 新选项卡\n\n新内容\n\n`));
    const remove = button('删除空项', () => {
      if (this.block.items.length <= 2 || selected.body?.text.trim()) return;
      const start = selected.heading.from - (selected.active ? '@tab:active '.length : '@tab '.length);
      const next = this.block.items[this.active + 1];
      this.replace(start, next ? next.heading.from - (next.active ? '@tab:active '.length : '@tab '.length) : this.block.closing.from, '');
    });
    remove.disabled = this.block.items.length <= 2 || !!selected.body?.text.trim();
    const left = button('左移', () => this.move(this.active, -1)); left.disabled = this.active === 0;
    const right = button('右移', () => this.move(this.active, 1)); right.disabled = this.active === this.block.items.length - 1;
    head.append(left, right, add, remove); panel.append(head);
    const host = document.createElement('div'); host.className = 'cm-visual-body'; panel.append(host);
    container.append(nav, panel); this.dom.append(container); this.mountBody(host, this.active);
  }
  private renderGrid(): void {
    const settings = document.createElement('div'); settings.className = 'cm-visual-row';
    settings.append(select(Array.from({ length: 6 }, (_, i) => [String(i + 1), `${i + 1} 列`]), String(this.block.columns), '画廊列数', (value) => this.changeGrid({ columns: Number(value) })));
    settings.append(input(this.block.aspect ?? '16/10', '图片比例', (value) => { if (/^\d{1,3}[/ :]\d{1,3}$/.test(value)) this.changeGrid({ aspect: value.replace(/[ :]/, '/') }); }));
    settings.append(select([['cover', '裁切填满'], ['contain', '完整显示']], this.block.fit ?? 'cover', '图片填充', (value) => this.changeGrid({ fit: value as 'cover' | 'contain' })));
    settings.append(button('添加图片', () => this.replace(this.block.closing.from, this.block.closing.from, '![图片描述](图片地址)\n\n')));
    this.dom.append(settings);
    const grid = document.createElement('div'); grid.className = 'md-grid';
    grid.style.setProperty('--md-grid-cols', String(this.block.columns)); grid.style.setProperty('--md-grid-cols-sm', String(Math.min(this.block.columns ?? 3, 2)));
    grid.style.setProperty('--md-grid-aspect', this.block.aspect ?? '16/10'); grid.style.setProperty('--md-grid-fit', this.block.fit ?? 'cover');
    this.block.items.forEach((item, index) => {
      const card = document.createElement('div'); card.className = 'cm-visual-image';
      const img = document.createElement('img'); img.src = item.url?.text ?? ''; img.alt = item.alt?.text ?? ''; img.loading = 'lazy';
      img.onerror = () => { img.style.display = 'none'; card.classList.add('cm-visual-image-error'); };
      card.append(img, input(item.alt?.text ?? '', `第 ${index + 1} 张图的描述`, (v) => { if (item.alt) this.replace(item.alt.from, item.alt.to, v.replace(/[\[\]\n]/g, '')); }),
        input(item.url?.text ?? '', `第 ${index + 1} 张图的地址`, (v) => { if (item.url) this.replace(item.url.from, item.url.to, v.replace(/[)\s]/g, '')); }));
      card.append(input(item.caption?.text ?? '', `第 ${index + 1} 张图的图注`, (v) => {
        const caption = v.replace(/["\n]/g, '');
        if (item.caption) this.replace(item.caption.from, item.caption.to, caption);
        else if (caption) this.replace(item.heading.to - 1, item.heading.to - 1, ` "${caption}"`);
      }));
      const left = button('←', () => this.move(index, -1), '图片左移'); left.disabled = index === 0;
      const right = button('→', () => this.move(index, 1), '图片右移'); right.disabled = index === this.block.items.length - 1;
      card.append(left, right);
      const remove = button('删除', () => this.replace(item.heading.from, item.heading.to, ''), '删除当前图片');
      remove.disabled = this.block.items.length <= 1; card.append(remove);
      grid.append(card);
    });
    this.dom.append(grid);
  }
  private changeGrid(patch: Partial<Pick<VisualBlock, 'columns' | 'aspect' | 'fit'>>): void {
    const next = { columns: patch.columns ?? this.block.columns, aspect: patch.aspect ?? this.block.aspect, fit: patch.fit ?? this.block.fit };
    this.replace(this.block.opening.from, this.block.opening.to, `:::grid columns=${next.columns} aspect=${next.aspect} fit=${next.fit}`);
  }
  private renderCollapse(): void {
    const settings = document.createElement('div'); settings.className = 'cm-visual-row';
    const accordion = document.createElement('label'), expand = document.createElement('label');
    const checkA = document.createElement('input'), checkE = document.createElement('input');
    checkA.type = checkE.type = 'checkbox'; checkA.checked = !!this.block.accordion; checkE.checked = !!this.block.expand;
    const updateFlags = () => this.replace(this.block.opening.from, this.block.opening.to,
      `:::collapse${checkA.checked ? ' accordion' : ''}${checkE.checked ? ' expand' : ''}`);
    checkA.addEventListener('change', updateFlags); checkE.addEventListener('change', updateFlags);
    accordion.append(checkA, ' 互斥展开'); expand.append(checkE, ' 默认展开');
    settings.append(accordion, expand, button('添加面板', () => this.replace(this.block.closing.from, this.block.closing.from, '- 新面板\n\n  新内容\n\n')));
    this.dom.append(settings);
    const group = document.createElement('div'); group.className = 'md-collapse';
    this.block.items.forEach((item, index) => {
      const panel = document.createElement('details'); panel.className = 'md-collapse-panel'; panel.open = this.expanded.has(index);
      panel.addEventListener('toggle', () => { if (panel.open) this.expanded.add(index); else this.expanded.delete(index); });
      const summary = document.createElement('summary'); summary.className = 'md-collapse-panel-title';
      summary.append(document.createTextNode(item.heading.text)); panel.append(summary);
      const inner = document.createElement('div'); inner.className = 'md-collapse-panel-body';
      const row = document.createElement('div'); row.className = 'cm-visual-row';
      row.append(input(item.heading.text, `第 ${index + 1} 项标题`, (v) => this.replace(item.heading.from, item.heading.to, v.replace(/\n/g, ''))));
      row.append(select([['', '跟随整组'], ['+', '默认展开'], ['-', '默认折叠']], item.state ?? '', '单项默认状态', (v) => {
        const prefix = item.heading.from - (item.state ? 5 : 2);
        this.replace(prefix, item.heading.from, `- ${v ? `:${v} ` : ''}`);
      }));
      const remove = button('删除空项', () => { if (item.body?.text.trim() || this.block.items.length <= 1) return;
        const next = this.block.items[index + 1];
        this.replace(item.heading.from - (item.state ? 5 : 2), next ? next.heading.from - (next.state ? 5 : 2) : this.block.closing.from, ''); });
      remove.disabled = this.block.items.length <= 1 || !!item.body?.text.trim();
      const up = button('上移', () => this.move(index, -1)); up.disabled = index === 0;
      const down = button('下移', () => this.move(index, 1)); down.disabled = index === this.block.items.length - 1;
      row.append(up, down, remove); inner.append(row);
      const host = document.createElement('div'); host.className = 'cm-visual-body'; inner.append(host); panel.append(inner); group.append(panel);
      if (panel.open) this.mountBody(host, index);
      panel.addEventListener('toggle', () => { if (panel.open) this.mountBody(host, index); });
    });
    this.dom.append(group);
  }
  private renderAdmonition(): void {
    const labels: Record<NonNullable<VisualBlock['admonitionType']>, [string, string]> = {
      note: ['备注', 'i'], tip: ['提示', '✦'], warning: ['注意', '!'], danger: ['危险', '⚠'], info: ['信息', 'ℹ'],
    };
    const type = this.block.admonitionType ?? 'note';
    const panel = document.createElement('aside');
    panel.className = `admonition admonition-${type}`;
    panel.dataset.admonition = type;
    const heading = document.createElement('div');
    heading.className = 'admonition-title';
    const icon = document.createElement('span'); icon.className = 'admonition-icon'; icon.textContent = labels[type][1];
    heading.append(icon, select(Object.entries(labels).map(([value, [label]]) => [value, label]), type, '提示块类型', (value) => {
      this.replace(this.block.opening.from, this.block.opening.to, `${':'.repeat(this.block.opening.text.match(/^:+/)?.[0].length ?? 3)}${value}`);
    }));
    const body = document.createElement('div'); body.className = 'admonition-body cm-visual-body';
    panel.append(heading, body); this.dom.append(panel);
    this.mountBody(body, 0);
  }
  private render(): void {
    this.closeChildren(); this.dom.replaceChildren(this.controlBar());
    if (this.block.kind === 'tabs') this.renderTabs();
    else if (this.block.kind === 'grid') this.renderGrid();
    else if (this.block.kind === 'admonition') this.renderAdmonition();
    else this.renderCollapse();
    this.structure = this.signature();
  }
  private signature(): string { return `${this.block.kind}:${this.block.items.length}:${this.active}:${this.block.opening.text}:${this.block.items.map((i) => `${i.heading.text}:${i.active}:${i.state}`).join('|')}`; }
  sync(block: VisualBlock): boolean {
    if (this.disposed || block.kind !== this.block.kind) return false;
    this.block = block; this.raw = block.raw;
    this.active = Math.min(this.active, block.items.length - 1);
    const structure = this.signature();
    if (structure !== this.structure) this.render();
    else for (const [index, child] of this.children) {
      const value = this.bodyContent(block.items[index]!);
      if (child.state.doc.toString() === value) continue;
      this.editing = true;
      try { child.dispatch({ changes: { from: 0, to: child.state.doc.length, insert: value } }); }
      finally { this.editing = false; }
    }
    return true;
  }
  revealAtSource(pos: number): boolean {
    const index = this.block.items.findIndex(item => item.body && item.body.from <= pos && pos <= item.body.to);
    if (index < 0 || this.disposed) return false;
    if (this.block.kind === 'tabs' && this.active !== index) { this.active = index; this.render(); }
    if (this.block.kind === 'collapse' && !this.expanded.has(index)) { this.expanded.add(index); this.render(); }
    const child = this.children.get(index);
    if (!child) return false;
    const body = this.block.items[index]!.body!;
    const prefix = this.parent.state.sliceDoc(body.from, pos);
    const offset = this.block.kind === 'collapse' ? prefix.split('\n').map(line => line.startsWith('  ') ? line.slice(2) : line).join('\n').length : prefix.length;
    unfoldHeadingAt(child, offset);
    child.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'center' }) });
    child.focus();
    return true;
  }
  destroy(): void { this.disposed = true; this.closeChildren(); }
}
class VisualWidget extends WidgetType {
  constructor(readonly block: VisualBlock, readonly options: Options) { super(); }
  eq(other: VisualWidget): boolean { return this.block.raw === other.block.raw && this.block.from === other.block.from; }
  toDOM(view: EditorView): HTMLElement { const dom = document.createElement('div'); controllers.set(dom, new VisualController(view, dom, this.block, this.options)); return dom; }
  updateDOM(dom: HTMLElement): boolean { return controllers.get(dom)?.sync(this.block) ?? false; }
  destroy(dom: HTMLElement): void { controllers.get(dom)?.destroy(); controllers.delete(dom); }
  ignoreEvent(): boolean { return true; }
}
export function revealVisualHeading(parent: EditorView, pos: number): boolean {
  for (const dom of parent.dom.querySelectorAll<HTMLElement>('.cm-visual-directive')) {
    const controller = controllers.get(dom);
    if (controller?.parent === parent && controller.revealAtSource(pos)) return true;
  }
  return false;
}

export function visualDirectivesExtension(options: Options = {}): Extension {
  const build = (state: EditorState): DecorationSet => {
    if (state.field(visualSource)) return Decoration.none;
    const columns = [...columnBlocks(state.doc), ...scanMarkdownCallouts(state.doc.toString())];
    return Decoration.set(scanVisualDirectives(state.doc.toString()).filter((block) =>
      !columns.some((column) => block.from >= column.from && block.to <= column.to)).map((block) =>
      Decoration.replace({ block: true, widget: new VisualWidget(block, options) }).range(block.from, block.to)));
  };
  const field = StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => tr.docChanged || tr.effects.some((effect) => effect.is(setVisualSource)) ? build(tr.state) : value,
    provide: (field) => EditorView.decorations.from(field),
  });
  return [visualSource, field];
}
