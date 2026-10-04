import { describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState, Text } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { characterCount } from '../src/components/admin/cm-character-count';
import { createPreviewDecorations } from '../src/components/admin/cm-preview-cache';
import { livePreview } from '../src/components/admin/cm-live-preview';
import { wysiwygPreview } from '../src/components/admin/cm-wysiwyg';
import { countChars } from '../src/lib/reading';

const decorations = (state: EditorState): DecorationSet => state.facet(EditorView.decorations)[0] as DecorationSet;

describe('编辑器增量字数', () => {
  it('空白、中文、emoji、多处替换与删行的结果等于全文计数', () => {
    let state = EditorState.create({ doc: '甲乙 丙\nabc 😀\n结尾', extensions: characterCount });
    expect(state.field(characterCount)).toBe(countChars(state.doc.toString()));
    state = state.update({ changes: [{ from: 0, to: 2, insert: '新增\t' }, { from: 5, to: 8, insert: 'B\n C' }] }).state;
    expect(state.field(characterCount)).toBe(countChars(state.doc.toString()));
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: '' } }).state;
    expect(state.field(characterCount)).toBe(0);
  });

  it('移动光标不串化全文，局部输入只统计变更片段', () => {
    const doc = Text.of(Array.from({ length: 1000 }, () => '长文 abc'));
    let state = EditorState.create({ doc, extensions: characterCount });
    const stringify = vi.spyOn(doc, 'toString');
    state = state.update({ selection: { anchor: 3 } }).state;
    state = state.update({ changes: { from: 3, insert: '新' } }).state;
    expect(stringify).not.toHaveBeenCalled();
    expect(state.field(characterCount)).toBe(5001);
    stringify.mockRestore();
  });
});

describe('预览装饰缓存', () => {
  it('同起点装饰按 startSide 排序，避免复杂文章整篇退回源码', () => {
    const build = createPreviewDecorations(() => [
      { from: 0, to: 0, deco: Decoration.widget({ widget: new class extends WidgetType {
        toDOM(): HTMLElement { return document.createElement('span'); }
      }() }) },
      { from: 0, to: 0, deco: Decoration.line({ attributes: { class: 'quote' } }) },
    ]);
    expect(build(EditorState.create({ doc: '正文' })).size).toBe(2);
  });

  it('不跨渲染块时复用装饰，切换编辑器不会挤掉缓存', () => {
    const compute = vi.fn(() => [{ from: 3, to: 6, deco: Decoration.replace({}), reveal: true }]);
    const build = createPreviewDecorations(compute);
    const a = EditorState.create({ doc: '0123456789' });
    const b = EditorState.create({ doc: 'abcdefghij' });
    const first = build(a);
    build(b);
    expect(build(a.update({ selection: { anchor: 1 } }).state)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(2);
    const revealed = build(a.update({ selection: { anchor: 4 } }).state);
    expect(revealed.size).toBe(0);
    expect(build(a.update({ selection: { anchor: 5 } }).state)).toBe(revealed);
    expect(build(a.update({ selection: { anchor: 6 } }).state).size).toBe(1);
  });

  it('文档变化后重新计算；多光标同时回显对应块', () => {
    const compute = vi.fn(() => [
      { from: 1, to: 3, deco: Decoration.replace({}), reveal: true },
      { from: 5, to: 8, deco: Decoration.replace({}), reveal: true },
    ]);
    const build = createPreviewDecorations(compute);
    let state = EditorState.create({ doc: '0123456789', extensions: EditorState.allowMultipleSelections.of(true) });
    expect(build(state).size).toBe(2);
    state = state.update({ selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(7)]) }).state;
    expect(build(state).size).toBe(0);
    expect(compute).toHaveBeenCalledTimes(1);
    build(state.update({ changes: { from: 9, insert: 'x' } }).state);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('光标进入引用行正文时回显该行隐藏的 Markdown 标记', () => {
    const build = createPreviewDecorations(() => [
      { from: 0, to: 2, deco: Decoration.replace({}), reveal: true, revealFrom: 0, revealTo: 10 },
    ]);
    const doc = '> 引用正文内容\n下一行';
    const initial = EditorState.create({ doc, selection: { anchor: doc.length } });
    expect(build(initial).size).toBe(1);
    const inside = initial.update({ selection: { anchor: 6 } }).state;
    expect(build(inside).size).toBe(0);
    expect(build(inside.update({ selection: { anchor: doc.length } }).state).size).toBe(1);
  });
});

for (const [name, extension] of [['Live Preview', livePreview()], ['WYSIWYG', wysiwygPreview()]] as const) {
  describe(name, () => {
    const create = (doc: string, extra: Extension = []): EditorState => EditorState.create({ doc, extensions: [extension, extra] });
    it('正文光标移动复用同一个装饰集', () => {
      const state = create('普通文本\n\n**加粗**\n\n![图](https://example.com/image.png)\n');
      expect(decorations(state).size).toBeGreaterThan(0);
      expect(decorations(state.update({ selection: { anchor: 2 } }).state)).toBe(decorations(state));
    });

    it('文末代码围栏无尾换行时，装饰范围不越过文档末尾', () => {
      const state = create('开头\n\n' + '```js\nconst x = 1;\n```');
      expect(decorations(state).size).toBeGreaterThan(0);
      const cursor = decorations(state).iter();
      while (cursor.value) {
        expect(cursor.to).toBeLessThanOrEqual(state.doc.length);
        cursor.next();
      }
    });

    it('光标进入图片回显源码，离开后恢复 widget', () => {
      const doc = '开头\n\n![图](https://example.com/image.png)\n末尾';
      const state = create(doc);
      const imagePos = doc.indexOf('![图]');
      const inside = state.update({ selection: { anchor: imagePos + 2 } }).state;
      expect(decorations(inside).size).toBeLessThan(decorations(state).size);
      const outside = inside.update({ selection: { anchor: 0 } }).state;
      expect(decorations(outside).size).toBe(decorations(state).size);
    });
  });
}

describe('WYSIWYG 格式与可视化控件', () => {
  const create = (doc: string) => EditorState.create({ doc, extensions: wysiwygPreview(), selection: { anchor: doc.length } });

  it.each(['**加粗**', '*斜体*', '`代码`', '~~删除~~', '[链接](https://example.com)', '<u>下划线</u>', ':spoiler[黑幕]', ':note[提示]', '==高亮=='])('%s 在光标进入时显示标记，离开后恢复预览', (syntax) => {
    const doc = `开头 ${syntax} 结尾`;
    const state = create(doc);
    const shown = decorations(state).size;
    expect(shown).toBeGreaterThan(0);
    const inside = state.update({ selection: { anchor: doc.indexOf(syntax) + Math.floor(syntax.length / 2) } }).state;
    expect(decorations(inside).size).toBeLessThan(shown);
    expect(decorations(inside.update({ selection: { anchor: doc.length } }).state).size).toBe(shown);
  });

  it('表格光标进入单元格后仍保持可视表格装饰', () => {
    const doc = '前文\n\n| 标题 | 内容 |\n| --- | --- |\n| 甲 | 乙 |\n\n后文';
    const state = create(doc);
    const inside = state.update({ selection: { anchor: doc.indexOf('甲') } }).state;
    expect(decorations(state).size).toBeGreaterThan(0);
    expect(decorations(inside).size).toBe(decorations(state).size);
  });
});
