import { EditorState, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, drawSelection, keymap, placeholder } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, redo, undo } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { scanMarkdownCallouts, serializeCalloutBody } from '../../lib/markdown-callouts';
import type { MarkdownCallout } from '../../lib/markdown-callouts';
import { CALLOUT_LABELS, CALLOUT_TYPES } from '../../lib/markdown-format-catalog';
import type { CalloutType } from '../../lib/markdown-format-catalog';
import { scanVisualDirectives } from '../../lib/markdown-visual-directives';
import { columnBlocks, registerEditorOwner, rootEditor, setColumnTarget } from './cm-columns-state';
import { headingFolding } from './cm-heading-folding';

interface Options {
  foldHeadings?: boolean;
  childExtensions: () => Extension;
  onSave: () => void;
  onPaste: (event: ClipboardEvent) => boolean;
  onContextMenu: (event: MouseEvent, child: EditorView, parent: EditorView) => boolean;
}
const controllers = new WeakMap<HTMLElement, CalloutController>();
const aliases: Record<string, CalloutType> = { abstract: 'note', summary: 'note', todo: 'info', hint: 'tip', important: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };

/** The body owns an ordinary Markdown editor; only the parent persists quote prefixes. */
class CalloutController {
  child: EditorView;
  syncing = false;
  disposed = false;
  private title = document.createElement('input');
  private type = document.createElement('select');
  private fold = document.createElement('button');
  private host = document.createElement('div');
  constructor(readonly parent: EditorView, readonly dom: HTMLElement, public block: MarkdownCallout, readonly options: Options) {
    dom.contentEditable = 'false';
    dom.setAttribute('role', 'group');
    dom.setAttribute('aria-label', 'Callout 引用编辑');
    const head = document.createElement('div'); head.className = 'callout-title';
    this.type.setAttribute('aria-label', 'Callout 类型');
    for (const value of CALLOUT_TYPES) {
      const option = document.createElement('option'); option.value = value; option.textContent = CALLOUT_LABELS[value]; this.type.append(option);
    }
    this.title.setAttribute('aria-label', 'Callout 标题');
    this.title.addEventListener('input', () => this.commitHeading());
    this.type.addEventListener('change', () => this.commitHeading());
    this.fold.type = 'button';
    this.fold.addEventListener('click', () => {
      this.host.hidden = !this.host.hidden;
      this.updateFold();
    });
    head.append(this.type, this.title, this.fold);
    this.host.className = 'callout-body';
    dom.append(head, this.host);
    this.host.hidden = block.fold === '-';
    this.presentation();
    this.child = new EditorView({ parent: this.host, state: EditorState.create({ doc: block.body, extensions: [
      EditorView.lineWrapping, drawSelection(), markdown(), options.childExtensions(), placeholder('在引用中写 Markdown…'),
      ...(options.foldHeadings ? [headingFolding()] : []),
      keymap.of([
        { key: 'Mod-z', run: () => undo(rootEditor(parent)), shift: () => redo(rootEditor(parent)) },
        { key: 'Mod-Shift-z', run: () => redo(rootEditor(parent)) },
        { key: 'Mod-y', run: () => redo(rootEditor(parent)) },
        { key: 'Mod-s', run: () => { options.onSave(); return true; } },
        ...defaultKeymap, ...searchKeymap,
      ]),
      EditorView.domEventHandlers({
        contextmenu: (event) => options.onContextMenu(event, this.child, parent),
        focus: (event) => { if (event.target === this.child.contentDOM) { setColumnTarget(parent, this.child); setColumnTarget(this.child); } return false; },
        paste: (event) => { setColumnTarget(parent, this.child); return options.onPaste(event); },
      }),
      EditorView.updateListener.of(update => {
        if (!this.syncing && update.docChanged) this.commit(serializeCalloutBody(this.block.heading, update.state.doc.toString()));
      }),
      EditorView.theme({
        '&': { backgroundColor: 'transparent', color: 'inherit', fontSize: 'inherit', minWidth: '0' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { fontFamily: 'inherit', overflow: 'visible' },
        '.cm-content': { padding: '8px 0', minHeight: '3rem' },
        '.cm-line': { padding: '0' },
      }),
    ] }) });
    registerEditorOwner(this.child, parent, () => {
      const { from, to, heading } = this.block, source = parent.state.doc.toString();
      return body => source.slice(0, from) + serializeCalloutBody(heading, body) + source.slice(to);
    });
    queueMicrotask(() => {
      if (this.disposed || !parent.hasFocus) return;
      const selection = parent.state.selection.main;
      if (selection.from < this.block.from || selection.to > this.block.to) return;
      if (selection.from <= this.block.from + this.block.heading.length) {
        this.title.focus(); this.title.select();
      } else {
        this.host.hidden = false; this.updateFold();
        this.child.focus(); setColumnTarget(parent, this.child);
      }
    });
  }
  private current(): boolean { return !this.disposed && this.parent.state.sliceDoc(this.block.from, this.block.to) === this.block.raw; }
  private commit(source: string): void {
    if (!this.current()) return;
    this.parent.dispatch({ changes: { from: this.block.from, to: this.block.to, insert: source }, userEvent: 'input.type' });
  }
  private commitHeading(): void {
    const heading = `> [!${this.type.value}]${this.block.fold} ${this.title.value.replace(/[\r\n]/g, '')}`;
    this.commit(serializeCalloutBody(heading, this.child.state.doc.toString()));
  }
  private updateFold(): void {
    this.fold.textContent = this.host.hidden ? '展开' : '收起';
    this.fold.setAttribute('aria-expanded', String(!this.host.hidden));
  }
  private presentation(): void {
    const type = aliases[this.block.type] ?? (CALLOUT_TYPES.includes(this.block.type as CalloutType) ? this.block.type as CalloutType : 'note');
    this.dom.className = `cm-callout-widget callout callout-${type}`;
    this.type.value = type;
    if (this.title.value !== this.block.title) this.title.value = this.block.title;
    this.title.placeholder = CALLOUT_LABELS[type];
    this.updateFold();
  }
  sync(block: MarkdownCallout): boolean {
    if (this.disposed) return false;
    this.block = block;
    this.presentation();
    if (this.child.state.doc.toString() !== block.body) {
      this.syncing = true;
      try { this.child.dispatch({ changes: { from: 0, to: this.child.state.doc.length, insert: block.body } }); }
      finally { this.syncing = false; }
    }
    return true;
  }
  destroy(): void { this.disposed = true; this.child.destroy(); }
}

class CalloutWidget extends WidgetType {
  constructor(readonly block: MarkdownCallout, readonly options: Options) { super(); }
  eq(other: CalloutWidget): boolean { return this.block.from === other.block.from && this.block.raw === other.block.raw; }
  toDOM(parent: EditorView): HTMLElement {
    const dom = document.createElement('div'); controllers.set(dom, new CalloutController(parent, dom, this.block, this.options)); return dom;
  }
  updateDOM(dom: HTMLElement): boolean { return controllers.get(dom)?.sync(this.block) ?? false; }
  ignoreEvent(): boolean { return true; }
  destroy(dom: HTMLElement): void { controllers.get(dom)?.destroy(); controllers.delete(dom); }
}

export function calloutsExtension(options: Options): Extension {
  const build = (state: EditorState): DecorationSet => {
    const owners = [...columnBlocks(state.doc), ...scanVisualDirectives(state.doc.toString())];
    return Decoration.set(scanMarkdownCallouts(state.doc.toString()).filter(block => !owners.some(owner => owner.from <= block.from && owner.to >= block.to))
      .map(block => Decoration.replace({ block: true, widget: new CalloutWidget(block, options) }).range(block.from, block.to)));
  };
  const field = StateField.define<DecorationSet>({ create: build, update: (value, tr) => tr.docChanged ? build(tr.state) : value, provide: field => EditorView.decorations.from(field) });
  return [field, EditorView.baseTheme({
    '.cm-callout-widget': { margin: '8px 0', minWidth: '0' },
    '.cm-callout-widget > .callout-title': { display: 'flex', gap: '8px', alignItems: 'center', minWidth: '0' },
    '.cm-callout-widget > .callout-title input': { flex: '1', minWidth: '0', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', outline: 'none' },
    '.cm-callout-widget > .callout-title select, .cm-callout-widget > .callout-title button': { border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '.8em', cursor: 'pointer' },
    '.cm-callout-widget > .callout-body': { minWidth: '0' },
  })];
}
