import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import { scanVisualDirectives } from './markdown-visual-directives';
import { scanMarkdownColumns } from './markdown-columns';

export interface HeadingSection {
  lineFrom: number;
  headingFrom: number;
  from: number;
  to: number;
  level: number;
  text: string;
}
const cache = new WeakMap<Text, { tree: ReturnType<typeof syntaxTree>; sections: Map<number, HeadingSection> }>();
const containerCache = new WeakMap<Text, { from: number; to: number }[]>();

/** Same-container heading boundaries exclude code and stop at quote/list boundaries. */
export function headingSections(state: EditorState, complete = false): Map<number, HeadingSection> {
  const tree = (complete ? ensureSyntaxTree(state, state.doc.length, 200) : null) ?? syntaxTree(state);
  const previous = cache.get(state.doc);
  if (previous?.tree === tree) return previous.sections;
  let embedded = containerCache.get(state.doc);
  if (!embedded) {
    const source = state.doc.toString();
    embedded = source.includes(':::') ? [...scanVisualDirectives(source), ...scanMarkdownColumns(source)] : [];
    containerCache.set(state.doc, embedded);
  }
  const groups = new Map<string, { end: number; headings: Omit<HeadingSection, 'to'>[] }>();
  tree.iterate({ enter(node) {
    const match = /^(?:ATXHeading([1-6])|SetextHeading([1-2]))$/.exec(node.name);
    if (!match) return;
    // Each visual widget has its own child editor and folding scope.
    if (embedded.some(block => block.from <= node.from && node.to <= block.to)) return;
    const parent = node.node.parent;
    if (!parent) return;
    const key = `${parent.name}:${parent.from}:${parent.to}`;
    let group = groups.get(key);
    if (!group) groups.set(key, group = { end: parent.to, headings: [] });
    group.headings.push({
      lineFrom: state.doc.lineAt(node.from).from,
      headingFrom: node.from, from: node.to,
      level: Number(match[1] ?? match[2]),
      text: state.sliceDoc(node.from, state.doc.lineAt(node.from).to).replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim(),
    });
  } });
  const sections = new Map<number, HeadingSection>();
  for (const group of groups.values()) {
    const stack: Omit<HeadingSection, 'to'>[] = [];
    const add = (heading: Omit<HeadingSection, 'to'>, end: number): void => {
      if (end > heading.from && state.sliceDoc(heading.from, end).trim()) sections.set(heading.lineFrom, { ...heading, to: end });
    };
    for (const heading of group.headings) {
      while (stack.length && stack[stack.length - 1]!.level >= heading.level) add(stack.pop()!, heading.lineFrom - 1);
      stack.push(heading);
    }
    // Do not offer a guessed end when a long document has only been partially parsed.
    if (tree.length === state.doc.length || group.end < tree.length) {
      for (const heading of stack) add(heading, group.end);
    }
  }
  cache.set(state.doc, { tree, sections });
  return sections;
}
