/**
 * md-keymap.ts —— Markdown 编辑快捷键（CodeMirror 6 keymap）
 *
 * 命令语义与 Obsidian 对齐（计算逻辑在 src/lib/md-commands.ts，绑定定义在 src/lib/editor-shortcuts.ts）：
 * - 加粗/斜体/删除线/行内代码：toggle —— 选区已带标记 → 去掉；未带 → 包上；无选区 → 插入空标记对光标居中
 * - 标题 Mod-1..6：设为 N 级；同级别 → 退回正文；作用于选区涉及的**每一行**
 * - 引用/无序/有序/任务列表：作用于选区每一行；整块已带前缀 → 整块移除
 * - 自定义：buildMdKeymap(bindings) —— 绑定来自设置（settings 表 editor_shortcuts 键），
 *   `mdKeymap` 保留为默认键位（向后兼容）
 */
import { keymap } from '@codemirror/view';
import type { Command, EditorView, KeyBinding } from '@codemirror/view';
import type { ChangeSpec } from '@codemirror/state';
import {
  allLinesHavePrefix,
  fencedBlock,
  headingLine,
  wrapText,
} from '../../lib/md-commands';
import { DEFAULT_BINDINGS, resolveBindings } from '../../lib/editor-shortcut-defs';

type View = EditorView;

/** 选区覆盖的行号区间（首行 → 末行） */
function selectionLines(view: View): { first: number; last: number } {
  const sel = view.state.selection.main;
  return {
    first: view.state.doc.lineAt(sel.from).number,
    last: view.state.doc.lineAt(sel.to).number,
  };
}

/** 对选区涉及的每一行应用行级变换（有变化才 dispatch） */
function mapSelectedLines(view: View, transform: (lineText: string, index: number) => string): boolean {
  const { first, last } = selectionLines(view);
  const changes: ChangeSpec[] = [];
  let index = 0;
  for (let n = first; n <= last; n += 1) {
    const line = view.state.doc.line(n);
    const next = transform(line.text, index);
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    index += 1;
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: 'md.line' });
  return true;
}

/** 收集选区涉及的行文本 */
function collectLines(view: View): string[] {
  const { first, last } = selectionLines(view);
  const lines: string[] = [];
  for (let n = first; n <= last; n += 1) lines.push(view.state.doc.line(n).text);
  return lines;
}

/** 行内标记 toggle（多选区：从后往前处理，保证偏移量正确） */
function toggleWrap(pre: string, suf: string): Command {
  return (view) => {
    const sel = view.state.selection;
    const ranges = [...sel.ranges].sort((a, b) => b.from - a.from);
    const changes: ChangeSpec[] = [];
    let mainAnchor = sel.main.anchor;
    let mainHead = sel.main.head;
    for (const r of ranges) {
      const line = view.state.doc.lineAt(r.from);
      const text = view.state.sliceDoc(line.from, line.to);
      const res = wrapText(text, pre, suf, r.from - line.from, r.to - line.from);
      changes.push({ from: line.from, to: line.to, insert: res.text });
      if (r === sel.main) {
        mainAnchor = line.from + res.from;
        mainHead = line.from + res.to;
      }
    }
    view.dispatch({ changes, selection: { anchor: mainAnchor, head: mainHead }, userEvent: 'md.wrap' });
    return true;
  };
}

/** 标题：设为 N 级 / 同级退回正文（作用于选区每一行）
 *  光标：主光标所在行转换后**定位到"# "之后**（与 Obsidian 一致，无需手动跳过井号）；
 *  退回正文时光标定位到行尾。 */
function setHeading(level: number): Command {
  return (view) => {
    const sel = view.state.selection.main;
    const mainLine = view.state.doc.lineAt(sel.head).number;
    const { first, last } = selectionLines(view);
    const changes: ChangeSpec[] = [];
    let cursorPos = -1;
    for (let n = first; n <= last; n += 1) {
      const line = view.state.doc.line(n);
      const next = headingLine(line.text, level);
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
      if (n === mainLine) {
        const m = next.match(/^(\s*)(#{1,6})\s/);
        // 设级别 → 井号之后；退回正文 → 行尾
        cursorPos = m ? line.from + (m[1] ?? '').length + (m[2] ?? '').length + 1 : line.from + next.length;
      }
    }
    if (changes.length === 0 && cursorPos < 0) return false;
    view.dispatch({
      changes,
      ...(cursorPos >= 0 ? { selection: { anchor: cursorPos } } : {}),
      userEvent: 'md.heading',
    });
    return true;
  };
}

/** 引用（toggle：整块已带 `> ` → 整块移除） */
const quote: Command = (view) => {
  const lines = collectLines(view);
  const already = allLinesHavePrefix(lines, '> ');
  return mapSelectedLines(view, (text) => {
    if (text.trim() === '') return text;
    if (already) return text.startsWith('> ') ? text.slice(2) : text;
    return `> ${text}`;
  });
};

/** 无序列表（toggle；已带短横、星号或数字编号前缀 → 整块移除） */
const ul: Command = (view) => {
  const lines = collectLines(view);
  const listRe = /^(\s*)(?:-|\*|\d+\.)\s+/;
  const allListed = lines.filter((l) => l.trim() !== '').every((l) => listRe.test(l));
  return mapSelectedLines(view, (text) => {
    if (text.trim() === '') return text;
    if (allListed) return text.replace(listRe, '$1');
    return `- ${text}`;
  });
};

/** 有序列表（toggle；已带编号 → 移除；否则按块内顺序编号） */
const ol: Command = (view) => {
  const lines = collectLines(view);
  const olRe = /^(\s*)\d+\.\s+/;
  const allOl = lines.filter((l) => l.trim() !== '').every((l) => olRe.test(l));
  let seq = 0;
  return mapSelectedLines(view, (text) => {
    if (text.trim() === '') return text;
    if (allOl) return text.replace(olRe, '$1');
    const lead = text.match(/^(\s*)/)?.[1] ?? '';
    return `${lead}${++seq}. ${text.slice(lead.length)}`;
  });
};

/** 任务列表（toggle - [ ]） */
const task: Command = (view) => {
  const lines = collectLines(view);
  const already = allLinesHavePrefix(lines, '- [ ] ');
  return mapSelectedLines(view, (text) => {
    if (text.trim() === '') return text;
    if (already) return text.startsWith('- [ ] ') ? text.slice(6) : text;
    return `- [ ] ${text}`;
  });
};

/** 代码块：选区 → 围栏包裹（空选区插入空围栏，光标停在语言行后） */
const codeBlock: Command = (view) => {
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  const insert = fencedBlock(selected);
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + 3 },
    userEvent: 'md.codeblock',
  });
  return true;
};

/** 链接：选中 → [text](url) 且选中 url；无选区 → 插入 [](url)，光标在 url 上 */
const link: Command = (view) => {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const res = wrapText(text, '[', '](url)', sel.from - sel.from, sel.to - sel.from);
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: res.text },
    selection: { anchor: sel.from + res.from + 1, head: sel.from + res.from + 4 },
    userEvent: 'md.link',
  });
  return true;
};

/** 命令表：id → Command（与 editor-shortcuts.ts 的定义 id 对应） */
export const MD_COMMANDS: Record<string, Command> = {
  bold: toggleWrap('**', '**'),
  italic: toggleWrap('*', '*'),
  strike: toggleWrap('~~', '~~'),
  inlineCode: toggleWrap('`', '`'),
  link: link as Command,
  codeBlock: codeBlock,
  heading1: setHeading(1),
  heading2: setHeading(2),
  heading3: setHeading(3),
  heading4: setHeading(4),
  heading5: setHeading(5),
  heading6: setHeading(6),
  quote: quote,
  ul: ul,
  ol: ol,
  task: task,
};

/**
 * 按绑定表构建 keymap
 *
 * @param bindings id → CodeMirror 绑定串（缺省用 DEFAULT_BINDINGS）
 * @param conflictPolicy 冲突时：'first' 保留最先注册的命令、忽略后续冲突项（默认）
 */
export function buildMdKeymap(bindings?: Record<string, string>, conflictPolicy: 'first' | 'all' = 'first') {
  const resolved = resolveBindings(bindings ?? {});
  const skip = new Set<string>();
  if (conflictPolicy === 'first') {
    for (const c of resolved.conflicts) for (const id of c.ids.slice(1)) skip.add(id);
  }
  const list: KeyBinding[] = [];
  for (const [id, binding] of Object.entries(resolved.bindings)) {
    if (skip.has(id)) continue;
    const run = MD_COMMANDS[id];
    if (!run) continue;
    list.push({ key: binding, run });
  }
  return keymap.of(list);
}

/** 默认键位（Obsidian 一致；向后兼容旧导入） */
export const mdKeymap = buildMdKeymap(DEFAULT_BINDINGS);
