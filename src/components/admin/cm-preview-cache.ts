import { RangeSetBuilder } from '@codemirror/state';
import type { EditorState, Text } from '@codemirror/state';
import type { Decoration, DecorationSet } from '@codemirror/view';

export interface PreviewDecoration {
  from: number;
  to: number;
  deco: Decoration;
  reveal?: boolean;
  /** 光标进入整个语法块时，才回显该装饰所隐藏的标记。 */
  revealFrom?: number;
  revealTo?: number;
}

/** 不可变文档缓存：光标未跨出当前渲染块时直接复用装饰集。 */
export function createPreviewDecorations(compute: (doc: Text) => PreviewDecoration[]): (state: EditorState) => DecorationSet {
  interface Cached {
    items: PreviewDecoration[];
    revealable: PreviewDecoration[];
    active: PreviewDecoration[];
    decorations?: DecorationSet;
  }
  const cache = new WeakMap<Text, Cached>();
  return (state) => {
    let base = cache.get(state.doc);
    if (!base) {
      // RangeSetBuilder requires equal-position ranges ordered by startSide.
      // Sorting by `to` first can put a replace before a line/widget decoration,
      // making the whole document fall back to raw Markdown in WYSIWYG mode.
      const items = compute(state.doc).sort((a, b) =>
        a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to,
      );
      base = { items, revealable: items.filter((item) => item.reveal), active: [] };
      cache.set(state.doc, base);
    }
    // 支持多光标与跨块选区；选中的渲染块都应回显源码。
    const active = base.revealable.filter((item) => state.selection.ranges.some(({ from, to }) => {
      const start = item.revealFrom ?? item.from;
      const end = item.revealTo ?? item.to;
      return (from < end && to > start) || (from >= start && from < end);
    }));
    if (base.decorations && active.length === base.active.length && active.every((item, i) => item === base.active[i])) {
      return base.decorations;
    }
    const hidden = new Set(active);
    const builder = new RangeSetBuilder<Decoration>();
    for (const item of base.items) {
      if (!hidden.has(item)) builder.add(item.from, item.to, item.deco);
    }
    const decorations = builder.finish();
    base.active = active;
    base.decorations = decorations;
    return decorations;
  };
}
