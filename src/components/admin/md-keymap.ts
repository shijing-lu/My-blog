/**
 * md-keymap.ts —— Markdown 编辑快捷键（CodeMirror 6 keymap）
 *
 * 常用格式化（包裹选区；无选区则插入标记对并把光标置于中间）：
 * - Ctrl/Cmd+B 加粗、I 斜体、E 行内代码、K 链接、Shift+X 删除线
 * 标题：
 * - Ctrl/Cmd+Alt+H 循环切换（H1→H2→H3→正文）
 * - Ctrl/Cmd+Alt+1~6 设为第 N 级标题；Ctrl/Cmd+Alt+0 清除标题
 */
import { keymap } from '@codemirror/view';
import type { Command } from '@codemirror/view';
import type { ChangeSpec } from '@codemirror/state';

/** 包裹选区（无选区则插入标记对，光标置于中间） */
function wrapWith(view: Parameters<Command>[0], pre: string, suf: string): boolean {
  const sel = view.state.selection;
  if (sel.ranges.every((r) => r.from === r.to)) {
    // 无选区：在光标处插入标记对，光标停在中间
    const pos = sel.main.head;
    view.dispatch({
      changes: { from: pos, insert: pre + suf },
      selection: { anchor: pos + pre.length },
      userEvent: 'md.wrap',
    });
    return true;
  }
  // 有选区：逐个包裹，保持多选
  const changes: ChangeSpec[] = sel.ranges.flatMap(
    (r) =>
      [
        { from: r.from, insert: pre },
        { to: r.to, insert: suf },
      ] as ChangeSpec[],
  );
  const anchor = sel.main.from + pre.length;
  const head = sel.main.to + pre.length;
  view.dispatch({ changes, selection: { anchor, head }, userEvent: 'md.wrap' });
  return true;
}

/** 加粗 **text** */
const bold: Command = (view) => wrapWith(view, '**', '**');
/** 斜体 *text* */
const italic: Command = (view) => wrapWith(view, '*', '*');
/** 行内代码 `text` */
const inlineCode: Command = (view) => wrapWith(view, '`', '`');
/** 删除线 ~~text~~ */
const strike: Command = (view) => wrapWith(view, '~~', '~~');
/** 链接 [text](url) */
const link: Command = (view) => wrapWith(view, '[', '](url)');

/** 设置/清除标题级别（作用于主光标所在行；level=0 清除） */
function setHeading(level: number): Command {
  return (view) => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const m = line.text.match(/^(\s*)(#{1,6})\s?(.*)$/);
    const lead = m?.[1] ?? '';
    const rest = (m?.[3] ?? line.text.trim()).trim();
    let insert: string;
    if (level === 0) {
      insert = `${lead}${rest}`;
    } else {
      const hashes = '#'.repeat(level);
      const current = m?.[2]?.length ?? 0;
      // 已是同级别 → 清除为正文；否则设为目标级别
      insert = current === level ? `${lead}${rest}` : `${lead}${hashes} ${rest}`;
    }
    view.dispatch({ changes: { from: line.from, to: line.to, insert }, userEvent: 'md.heading' });
    return true;
  };
}

/** 循环切换标题：正文 → H1 → H2 → H3 → 正文 */
const cycleHeading: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = line.text.match(/^(\s*)(#{1,6})\s?(.*)$/);
  const current = m?.[2]?.length ?? 0;
  const next = current === 0 ? 1 : current === 1 ? 2 : current === 2 ? 3 : 0;
  return setHeading(next)(view);
};

/** Markdown 自定义快捷键 */
export const mdKeymap = keymap.of([
  { key: 'Mod-b', run: bold },
  { key: 'Mod-i', run: italic },
  { key: 'Mod-e', run: inlineCode },
  { key: 'Mod-k', run: link },
  { key: 'Mod-Shift-x', run: strike },
  { key: 'Mod-Alt-h', run: cycleHeading },
  { key: 'Mod-Alt-1', run: setHeading(1) },
  { key: 'Mod-Alt-2', run: setHeading(2) },
  { key: 'Mod-Alt-3', run: setHeading(3) },
  { key: 'Mod-Alt-4', run: setHeading(4) },
  { key: 'Mod-Alt-5', run: setHeading(5) },
  { key: 'Mod-Alt-6', run: setHeading(6) },
  { key: 'Mod-Alt-0', run: setHeading(0) },
]);
