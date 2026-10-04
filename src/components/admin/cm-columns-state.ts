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
export function setColumnTarget(parent: EditorView, child?: EditorView): void {
  if (child) activeChildren.set(parent, child);
  else activeChildren.delete(parent);
}
export function columnTarget(parent: EditorView | null): EditorView | null {
  const child = parent && activeChildren.get(parent);
  return child?.dom.isConnected ? child : parent;
}

export const pendingColumnFocus = new WeakMap<EditorView, { pos: number; column: number; offset: number }>();
