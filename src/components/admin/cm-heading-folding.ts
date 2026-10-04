import { codeFolding, foldEffect, foldedRanges, foldState, syntaxTree, unfoldEffect } from '@codemirror/language';
import { EditorView, GutterMarker, ViewPlugin, gutter, keymap } from '@codemirror/view';
import type { EditorState, Extension, StateEffect } from '@codemirror/state';
import { headingSections } from '../../lib/heading-fold-ranges';
import type { HeadingSection } from '../../lib/heading-fold-ranges';

const childFoldMemory = new WeakMap<EditorView, Map<string, { content: string; ranges: { from: number; to: number }[] }>>();

/** Visual widgets are recreated by virtualization and by enclosing chapter folds. */
export function rememberChildHeadingFolds(parent: EditorView, key: string, child: EditorView): void {
  if (!child.state.field(foldState, false)) return;
  let memory = childFoldMemory.get(parent);
  if (!memory) childFoldMemory.set(parent, memory = new Map());
  if (memory.size >= 128 && !memory.has(key)) memory.delete(memory.keys().next().value!);
  const ranges: { from: number; to: number }[] = [];
  foldedRanges(child.state).between(0, child.state.doc.length, (from, to) => { ranges.push({ from, to }); });
  memory.set(key, { content: child.state.doc.toString(), ranges });
}

export function restoreChildHeadingFolds(parent: EditorView, key: string, child: EditorView): void {
  const saved = childFoldMemory.get(parent)?.get(key);
  if (!saved || saved.content !== child.state.doc.toString() || !saved.ranges.length) return;
  child.dispatch({ effects: saved.ranges.map(range => foldEffect.of(range)) });
}

function foldedAt(state: EditorState, from: number): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null;
  foldedRanges(state).between(from, from, (a, b) => { if (a === from) range = { from: a, to: b }; });
  return range;
}

export function unfoldHeadingAt(view: EditorView, pos: number): void {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(pos, pos, (from, to) => {
    if (from < pos && to > pos) effects.push(unfoldEffect.of({ from, to }));
  });
  if (foldedRanges(view.state).size) {
    const section = headingSections(view.state, true).get(view.state.doc.lineAt(pos).from);
    const own = section ? foldedAt(view.state, section.from) : null;
    if (own && !effects.some(effect => effect.is(unfoldEffect) && effect.value.from === own.from)) effects.push(unfoldEffect.of(own));
  }
  if (effects.length) view.dispatch({ effects });
}

export function isHeadingFolded(state: EditorState, pos: number): boolean {
  let hidden = false;
  foldedRanges(state).between(pos, pos, (from, to) => { if (from < pos && to > pos) hidden = true; });
  return hidden;
}

function toggleHeading(view: EditorView, lineFrom: number, expand?: boolean): boolean {
  const section = headingSections(view.state, true).get(lineFrom);
  if (!section) return false;
  const folded = foldedAt(view.state, section.from);
  if (expand === true && !folded || expand === false && folded) return false;
  view.dispatch({ effects: [
    folded ? unfoldEffect.of(folded) : foldEffect.of(section),
    EditorView.announce.of(`${folded ? '已展开' : '已折叠'}${section.level}级标题：${section.text}`),
  ] });
  return true;
}

class HeadingMarker extends GutterMarker {
  constructor(readonly section: HeadingSection, readonly open: boolean) { super(); }
  eq(other: HeadingMarker): boolean {
    return this.open === other.open && this.section.lineFrom === other.section.lineFrom && this.section.from === other.section.from && this.section.to === other.section.to && this.section.level === other.section.level && this.section.text === other.section.text;
  }
  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-heading-fold-button';
    const headingScale = [1.7, 1.45, 1.25, 1.1, 1, 1][this.section.level - 1]!;
    button.style.marginTop = `${(1.75 * headingScale - 1.5) / 2}rem`;
    button.setAttribute('aria-expanded', String(this.open));
    button.setAttribute('aria-label', `${this.open ? '折叠' : '展开'}${this.section.level}级标题：${this.section.text}`);
    button.title = button.getAttribute('aria-label')!;
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggleHeading(view, this.section.lineFrom); });
    return button;
  }
}

export function headingFolding(): Extension {
  return [
    // CodeMirror hides decorative gutters from assistive technology by default.
    // This gutter contains interactive buttons, so expose it once the DOM is mounted.
    ViewPlugin.fromClass(class {
      constructor(view: EditorView) {
        view.requestMeasure({ read: () => null, write: () => view.dom.querySelector('.cm-gutters')?.removeAttribute('aria-hidden') });
      }
    }),
    codeFolding({ placeholderDOM(_view, onclick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-foldPlaceholder';
      button.textContent = '…';
      button.setAttribute('aria-label', '展开章节');
      button.title = '展开章节';
      button.addEventListener('click', onclick);
      return button;
    } }),
    gutter({
      class: 'cm-heading-fold-gutter',
      lineMarker(view, line) {
        const section = headingSections(view.state).get(line.from);
        return section ? new HeadingMarker(section, !foldedAt(view.state, section.from)) : null;
      },
      lineMarkerChange(update) {
        return update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.startState.field(foldState, false) !== update.state.field(foldState, false);
      },
    }),
    keymap.of([
      { key: 'Ctrl-Shift-[', mac: 'Cmd-Alt-[', run: view => toggleHeading(view, view.state.doc.lineAt(view.state.selection.main.head).from, false) },
      { key: 'Ctrl-Shift-]', mac: 'Cmd-Alt-]', run: view => toggleHeading(view, view.state.doc.lineAt(view.state.selection.main.head).from, true) },
    ]),
    EditorView.theme({
      '&.cm-editor .cm-gutters': { borderRight: 'none', backgroundColor: 'transparent' },
      '.cm-heading-fold-gutter': { width: '1.75rem' },
      '.cm-heading-fold-gutter .cm-gutterElement': { padding: '0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' },
      '.cm-foldPlaceholder': { background: 'var(--color-muted)', color: 'var(--color-muted-foreground)', border: 'none', padding: '0 0.4em', borderRadius: '0.3rem', marginLeft: '0.5em', cursor: 'pointer', fontSize: '0.75em' },
    }),
  ];
}
