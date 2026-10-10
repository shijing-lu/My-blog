import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';
import { searchPanelOpen } from '@codemirror/search';

/** Searching may unfold a match. Restore untouched chapters when the panel closes. */
export const searchFoldRestoration = ViewPlugin.fromClass(class {
  private folds: { from: number; to: number }[] = [];
  private open = false;
  constructor(private view: EditorView) {}
  update(update: ViewUpdate) {
    const open = searchPanelOpen(update.state);
    if (open && !this.open) {
      this.folds = []; foldedRanges(update.startState).between(0, update.startState.doc.length, (from, to) => { this.folds.push({ from, to }); });
    }
    if (open && update.docChanged) {
      this.folds = this.folds.filter(fold => !update.changes.touchesRange(fold.from, fold.to)).map(fold => ({ from: update.changes.mapPos(fold.from), to: update.changes.mapPos(fold.to) }));
    }
    // Explicit folding while searching takes precedence over the initial snapshot.
    if (this.open) for (const transaction of update.transactions) for (const effect of transaction.effects) {
      if (effect.is(foldEffect) || effect.is(unfoldEffect)) this.folds = this.folds.filter(fold => fold.from !== effect.value.from);
    }
    if (!open && this.open) {
      const folds = this.folds; this.folds = [];
      queueMicrotask(() => { if (this.view.dom.isConnected && !searchPanelOpen(this.view.state)) this.view.dispatch({ effects: folds.map(fold => foldEffect.of(fold)) }); });
    }
    this.open = open;
  }
});
