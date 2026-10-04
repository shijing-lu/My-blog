import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import { headingSections } from '../src/lib/heading-fold-ranges';
import { pickNearestViewAnchor, pickViewAnchor } from '../src/lib/view-anchor';

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), codeFolding()] });
const ranges = (state: EditorState) => [...headingSections(state, true).values()].sort((a, b) => a.headingFrom - b.headingFrom);
const folds = (state: EditorState) => { const result: [number, number][] = []; foldedRanges(state).between(0, state.doc.length, (a, b) => { result.push([a, b]); }); return result; };

describe('body heading section boundaries', () => {
  it('covers all six levels and includes children until a same or higher sibling', () => {
    const doc = '前言\n\n' + Array.from({ length: 6 }, (_, n) => `${'#'.repeat(n + 1)} L${n + 1}\n\n正文${n + 1}\n`).join('\n') + '\n## Next\n\n结尾';
    const sections = ranges(stateOf(doc));
    expect(sections.map(s => s.level)).toEqual([1, 2, 3, 4, 5, 6, 2]);
    expect(doc.slice(sections[1]!.from, sections[1]!.to)).toContain('正文6');
    expect(doc.slice(sections[1]!.from, sections[1]!.to)).not.toContain('Next');
    expect(sections[0]!.to).toBe(doc.length);
    expect(sections.at(-1)!.to).toBe(doc.length);
  });

  it('handles skipped levels, repeated headings and empty sections', () => {
    const doc = '# A\n\n##### Child\n\n内容\n\n## Same\n\n甲\n\n## Same\n\n乙\n\n## Empty';
    const sections = ranges(stateOf(doc));
    expect(sections.map(s => s.text)).toEqual(['A', 'Child', 'Same', 'Same']);
    expect(doc.slice(sections[2]!.from, sections[2]!.to).trim()).toBe('甲');
    expect(doc.slice(sections[3]!.from, sections[3]!.to).trim()).toBe('乙');
  });

  it('starts Setext folds after the underline and ignores fake code headings', () => {
    const doc = '一级\n===\n\n```md\n# fake\n```\n\n二级\n---\n\n正文';
    const sections = ranges(stateOf(doc));
    expect(sections.map(s => s.level)).toEqual([1, 2]);
    expect(doc.slice(0, sections[0]!.from)).toBe('一级\n===');
    expect(doc.slice(sections[1]!.from, sections[1]!.to).trim()).toBe('正文');
  });

  it('does not hide text outside a blockquote or list item', () => {
    const doc = '# Outer\n\n> ## Quote\n>\n> 引用内\n\n引用外\n\n- ## Item\n\n  列表内\n\n列表外\n\n## Next\n\n尾声';
    const sections = ranges(stateOf(doc));
    const quote = sections.find(s => s.text === 'Quote')!;
    const item = sections.find(s => s.text === 'Item')!;
    expect(doc.slice(quote.from, quote.to)).toContain('引用内');
    expect(doc.slice(quote.from, quote.to)).not.toContain('引用外');
    expect(doc.slice(item.from, item.to)).toContain('列表内');
    expect(doc.slice(item.from, item.to)).not.toContain('列表外');
  });

  it('completes a long tree for an actual fold and caches a stable parsed document', () => {
    const state = stateOf(Array.from({ length: 30 }, (_, n) => `## ${n}\n\n${'正文'.repeat(2500)}\n`).join('\n'));
    const sections = headingSections(state, true);
    expect(sections.size).toBe(30);
    expect(headingSections(state, true)).toBe(sections);
  });
  it('uses independent scopes for callout and column child editors', () => {
    const doc = '### Outer\n\n:::note\n# Note\n\n内容\n:::\n\n提示外\n\n:::columns\n::column\n# Left\n\n甲\n::column\n# Right\n\n乙\n:::\n\n分栏外\n\n### End\n\n尾声';
    const sections = ranges(stateOf(doc));
    expect(sections.map(s => s.text)).toEqual(['Outer', 'End']);
    expect(doc.slice(sections[0]!.from, sections[0]!.to)).toContain('分栏外');
    expect(doc.slice(sections[0]!.from, sections[0]!.to)).not.toContain('### End');
    expect(ranges(stateOf('# Note\n\n内容'))).toHaveLength(1);
  });
});

describe('fold effects preserve the full editor document', () => {
  const doc = '# A\n\n正文\n\n## Child\n\n隐藏正文\n\n# B\n\n尾声';
  it('retains nested child folds when the parent opens, without a content change', () => {
    let state = stateOf(doc);
    const [parent, child] = ranges(state);
    state = state.update({ effects: foldEffect.of(child!) }).state;
    const folded = state.update({ effects: foldEffect.of(parent!) });
    expect(folded.docChanged).toBe(false);
    state = folded.state;
    expect(state.doc.toString()).toBe(doc);
    expect(folds(state)).toHaveLength(2);
    state = state.update({ effects: unfoldEffect.of(parent!) }).state;
    expect(folds(state)).toEqual([[child!.from, child!.to]]);
    expect(state.doc.toString()).toBe(doc);
  });
  it('preserves hidden text in the full value used by autosave after an edit', () => {
    let state = stateOf(doc);
    const child = ranges(state)[1]!;
    state = state.update({ effects: foldEffect.of(child) }).state;
    const changed = state.update({ changes: { from: 0, insert: '前言\n\n' } });
    expect(changed.docChanged).toBe(true);
    expect(changed.state.doc.toString()).toBe('前言\n\n' + doc);
    expect(folds(changed.state)).toEqual([[child.from + 4, child.to + 4]]);
  });
  it('selection into hidden content opens its enclosing folds', () => {
    let state = stateOf(doc);
    const [parent, child] = ranges(state);
    state = state.update({ effects: foldEffect.of(child!) }).state;
    state = state.update({ effects: foldEffect.of(parent!) }).state;
    state = state.update({ selection: { anchor: doc.indexOf('隐藏正文') } }).state;
    expect(folds(state)).toEqual([]);
    expect(state.doc.toString()).toBe(doc);
  });
});

describe('viewport anchors skip hidden headings without changing their identity', () => {
  const headings = [{ level: 2, top: -30 }, { level: 3, top: 0, hidden: true }, { level: 2, top: 0, hidden: true }, { level: 2, top: 5 }];
  it('uses the visible third H2 in both anchor selection modes', () => {
    expect(pickNearestViewAnchor(headings)).toEqual({ level: 2, nth: 2, offset: 5 });
    expect(pickViewAnchor(headings)).toEqual({ level: 2, nth: 2, offset: 5 });
  });
});
