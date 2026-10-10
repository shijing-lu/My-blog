import { Annotation, EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { scanMarkdownColumns } from '../../lib/markdown-columns';
import type { MarkdownColumns } from '../../lib/markdown-columns';

const cache = new WeakMap<Text, MarkdownColumns[]>();
export const columnsEdit = Annotation.define<MarkdownColumns>();
/** Preserve widget-owned boundaries during incomplete Markdown input. Source-mode
 * edits still reparse normally; edits outside a group only map its positions. */
export const columnsTransactionCache = EditorState.transactionExtender.of((transaction) => {
  if (!transaction.docChanged) return null;
  const owned = transaction.annotation(columnsEdit);
  const blocks = scanMarkdownColumns(transaction.newDoc.toString());
  const preserved: MarkdownColumns[] = [];
  for (const block of columnBlocks(transaction.startState.doc)) {
    let touched = false;
    transaction.changes.iterChangedRanges((from, to) => {
      if ((from < block.to && to > block.from) || (from === to && from > block.from && from < block.to)) touched = true;
    });
    if (!touched) {
      const map = (pos: number): number => transaction.changes.mapPos(pos, 1);
      // Text appended after the closing fence belongs outside the group.
      preserved.push({ ...block, from: map(block.from), to: transaction.changes.mapPos(block.to, -1), columns: block.columns.map((column) => ({ ...column, from: map(column.from), to: map(column.to) })) });
    }
  }
  if (owned) preserved.push(owned);
  cache.set(transaction.newDoc, [
    ...blocks.filter((block) => !preserved.some((other) => block.from < other.to && block.to > other.from)),
    ...preserved,
  ].sort((a, b) => a.from - b.from));
  return null;
});
export function columnBlocks(doc: Text): MarkdownColumns[] {
  let blocks = cache.get(doc);
  if (!blocks) { blocks = scanMarkdownColumns(doc.toString()); cache.set(doc, blocks); }
  return blocks;
}

export const setColumnsSource = StateEffect.define<boolean>();
export const columnsSource = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setColumnsSource)) value = effect.value;
    return value;
  },
});

const activeChildren = new WeakMap<EditorView, EditorView>();
const owners = new WeakMap<EditorView, EditorView>();
const projections = new WeakMap<EditorView, () => (source: string) => string>();
export function registerEditorOwner(child: EditorView, parent: EditorView, projection?: () => (source: string) => string): void {
  owners.set(child, parent); if (projection) projections.set(child, projection);
}
/** Freeze serialization functions before a dialog takes focus; never dispatch into a stale child. */
export function captureEditorProjection(view: EditorView): { root: EditorView; project: (source: string) => string } | null {
  const steps: Array<(source: string) => string> = [];
  let parent = owners.get(view);
  while (parent) {
    const factory = projections.get(view); if (!factory) return null;
    steps.push(factory()); view = parent; parent = owners.get(view);
  }
  return { root: view, project: source => steps.reduce((value, step) => step(value), source) };
}
export function rootEditor(view: EditorView): EditorView {
  let owner = owners.get(view);
  while (owner) { view = owner; owner = owners.get(view); }
  return view;
}
export function setColumnTarget(parent: EditorView, child?: EditorView): void {
  if (child) {
    activeChildren.set(parent, child);
    let owner = owners.get(parent);
    while (owner) { activeChildren.set(owner, parent); parent = owner; owner = owners.get(parent); }
  }
  else activeChildren.delete(parent);
}
export function columnTarget(parent: EditorView | null): EditorView | null {
  const seen = new Set<EditorView>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const child = activeChildren.get(parent);
    if (!child?.dom.isConnected) break;
    parent = child;
  }
  return parent;
}

export const pendingColumnFocus = new WeakMap<EditorView, { pos: number; column: number; offset: number }>();
