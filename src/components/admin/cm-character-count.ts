import { StateField } from '@codemirror/state';
import { countChars } from '../../lib/reading';

/** 字数只统计改动片段；移动光标和滚动时复用结果，不再扫描全文。 */
export const characterCount = StateField.define<number>({
  create: (state) => countChars(state.doc.toString()),
  update: (count, transaction) => {
    if (!transaction.docChanged) return count;
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      count -= countChars(transaction.startState.sliceDoc(from, to));
      count += countChars(inserted.toString());
    });
    return count;
  },
});
