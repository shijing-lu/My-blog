/**
 * cm-table.ts —— Markdown 表格的「所见即所得」编辑 Widget（Obsidian 式）
 *
 * 交互：
 * - 表格在编辑区内直接渲染为可视化表格；点击任意单元格原地编辑（contenteditable）
 * - Tab / Shift+Tab 在单元格间跳转；最后一格 Tab / 任意格 Enter → 自动新建一行并跳入
 * - 空数据格 Backspace → 删除该行（保留表头与至少一行数据）
 * - 对齐来自分隔行（:--- / :---: / ---:）；单元格内 `|` 自动转义
 * - 编辑回写：单元格输入 300ms 防抖后重建 Markdown 并替换源码，
 *   通过 pendingTableFocus 在重建后恢复焦点与光标
 */
import { EditorView, WidgetType } from '@codemirror/view';

/** 解析分隔行的对齐 */
export type TableAlign = 'left' | 'center' | 'right';

/** 表格块解析结果 */
export interface ParsedTable {
  header: string[];
  aligns: TableAlign[];
  rows: string[][];
}

/** 是否为表格分隔行（| --- | :--: |） */
export function isTableSeparator(text: string): boolean {
  const t = text.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (!t.includes('-')) return false;
  return t.split('|').every((c) => /^\s*:?-{2,}:?\s*$/.test(c));
}

/** 是否为表格行（以 | 开头或结尾，且含 |） */
export function isTableRow(text: string): boolean {
  const t = text.trim();
  return t.startsWith('|') && t.includes('|', 1);
}

/** 拆分一行单元格（处理 \| 转义） */
export function splitRow(text: string): string[] {
  let t = text.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i]!;
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** 解析表格块（行文本数组） */
export function parseTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2) return null;
  if (!isTableRow(lines[0]!) || !isTableSeparator(lines[1]!)) return null;
  const header = splitRow(lines[0]!);
  const sep = splitRow(lines[1]!);
  const aligns: TableAlign[] = header.map((_, i) => {
    const c = sep[i] ?? sep[sep.length - 1] ?? '---';
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const cells = splitRow(lines[i]!);
    while (cells.length < header.length) cells.push('');
    rows.push(cells.slice(0, header.length));
  }
  return { header, aligns, rows };
}

/** 单元格文本 → Markdown 转义 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

/** 重建 Markdown 表格源码 */
export function buildTableMarkdown(parsed: ParsedTable): string {
  const sep = parsed.aligns
    .map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : ':---'))
    .join(' | ');
  const rowLine = (cells: string[]): string => `| ${cells.map(escapeCell).join(' | ')} |`;
  const out = [rowLine(parsed.header), `| ${sep} |`];
  for (const r of parsed.rows) out.push(rowLine(r));
  return out.join('\n');
}

/** 跨重建传递的焦点（行 = 0 是表头；-1 表示不聚焦） */
let pendingTableFocus: { r: number; c: number; caretAtEnd?: boolean } | null = null;

/** 请求重建后把焦点放到指定单元格 */
export function requestTableFocus(r: number, c: number): void {
  pendingTableFocus = { r, c, caretAtEnd: true };
}

/** 单元格 DOM：让光标置于文本末尾 */
function focusCell(td: HTMLTableCellElement): void {
  td.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(td);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export class TableWidget extends WidgetType {
  constructor(
    readonly raw: string,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.raw === this.raw && other.pos === this.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const parsed = parseTable(this.raw.split('\n'));
    const wrap = document.createElement('div');
    wrap.className = 'md-table-widget';
    if (!parsed) {
      wrap.textContent = this.raw;
      return wrap;
    }
    const { header, aligns, rows } = parsed;

    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.margin = '6px 0';
    table.style.fontSize = '0.92em';

    const cellStyle = (td: HTMLTableCellElement, col: number, isHead: boolean): void => {
      td.style.border = '1px solid rgba(128,128,128,0.35)';
      td.style.padding = '4px 10px';
      td.style.minWidth = '56px';
      td.style.textAlign = aligns[col] ?? 'left';
      td.contentEditable = 'true';
      td.spellcheck = false;
      if (isHead) {
        td.style.background = 'rgba(128,128,128,0.12)';
        td.style.fontWeight = '600';
      }
      td.addEventListener('focus', () => {
        td.style.outline = '2px solid rgba(96,165,250,0.55)';
        td.style.outlineOffset = '-2px';
      });
      td.addEventListener('blur', () => {
        td.style.outline = '';
      });
    };

    /** 从 DOM 收集全部单元格文本 */
    const collect = (): { header: string[]; rows: string[][] } => {
      const trs = Array.from(table.rows);
      const head = Array.from(trs[0]!.cells).map((td) => td.textContent ?? '');
      const rest = trs.slice(1).map((tr) => Array.from(tr.cells).map((td) => td.textContent ?? ''));
      return { header: head, rows: rest };
    };

    /** 防抖回写源码（重建后按 pendingTableFocus 恢复焦点） */
    let timer: number | null = null;
    const scheduleWrite = (focus: { r: number; c: number }): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const data = collect();
        requestTableFocus(focus.r, focus.c);
        view.dispatch({
          changes: {
            from: this.pos,
            to: this.pos + this.raw.length,
            insert: buildTableMarkdown({ header: data.header, aligns, rows: data.rows }),
          },
          userEvent: 'md.table',
        });
      }, 300);
    };

    const buildTableDom = (): void => {
      table.textContent = '';
      const thead = table.createTHead();
      const hr = thead.insertRow();
      header.forEach((text, c) => {
        const th = hr.insertCell();
        th.textContent = text;
        cellStyle(th, c, true);
      });
      const tbody = table.createTBody();
      for (const row of rows) {
        const tr = tbody.insertRow();
        row.forEach((text, c) => {
          const td = tr.insertCell();
          td.textContent = text;
          cellStyle(td, c, false);
        });
      }
    };
    buildTableDom();

    const cellAt = (r: number, c: number): HTMLTableCellElement | null => {
      const tr = table.rows[r];
      return tr ? (tr.cells[c] as HTMLTableCellElement | undefined) ?? null : null;
    };

    /** 键盘导航与增删行 */
    table.addEventListener('keydown', (e) => {
      const td = e.target as HTMLTableCellElement;
      if (!td || !table.contains(td)) return;
      const r = td.parentElement ? (td.parentElement as HTMLTableRowElement).rowIndex : 0;
      const c = td.cellIndex;
      const dataRows = table.rows.length - 1;

      if (e.key === 'Tab') {
        e.preventDefault();
        if (!e.shiftKey) {
          if (c === table.rows[0]!.cells.length - 1 && r === table.rows.length - 1) {
            // 最后一格 Tab → 追加一行并跳入首格
            const data = collect();
            data.rows.push(data.header.map(() => ''));
            requestTableFocus(data.rows.length, 0);
            view.dispatch({
              changes: {
                from: this.pos,
                to: this.pos + this.raw.length,
                insert: buildTableMarkdown({ header: data.header, aligns, rows: data.rows }),
              },
              userEvent: 'md.table.row',
            });
            return;
          }
          if (c < table.rows[r]!.cells.length - 1) {
            const next = cellAt(r, c + 1);
            if (next) focusCell(next);
            return;
          }
          const nextRow = cellAt(r + 1, 0);
          if (nextRow) focusCell(nextRow);
          return;
        }
        // Shift+Tab：向前
        if (c > 0) {
          const prev = cellAt(r, c - 1);
          if (prev) focusCell(prev);
          return;
        }
        const prevRow = cellAt(r - 1, table.rows[0]!.cells.length - 1);
        if (prevRow) focusCell(prevRow);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const data = collect();
        data.rows.splice(r, 0, data.header.map(() => ''));
        requestTableFocus(r + 1, c);
        view.dispatch({
          changes: {
            from: this.pos,
            to: this.pos + this.raw.length,
            insert: buildTableMarkdown({ header: data.header, aligns, rows: data.rows }),
          },
          userEvent: 'md.table.row',
        });
        return;
      }

      if (e.key === 'Backspace' && r > 0 && dataRows > 1) {
        const text = td.textContent ?? '';
        const sel = window.getSelection();
        const caretAtStart =
          text === '' || (sel && sel.isCollapsed && sel.anchorOffset === 0 && (sel.anchorNode === td || td.contains(sel.anchorNode)));
        if (caretAtStart) {
          e.preventDefault();
          const data = collect();
          data.rows.splice(r - 1, 1);
          requestTableFocus(Math.max(0, r - 1), c);
          view.dispatch({
            changes: {
              from: this.pos,
              to: this.pos + this.raw.length,
              insert: buildTableMarkdown({ header: data.header, aligns, rows: data.rows }),
            },
            userEvent: 'md.table.row',
          });
        }
      }
    });

    /** 输入 → 防抖回写 */
    table.addEventListener('input', (e) => {
      const td = e.target as HTMLTableCellElement;
      if (!td || !table.contains(td)) return;
      const r = td.parentElement ? (td.parentElement as HTMLTableRowElement).rowIndex : 0;
      const c = td.cellIndex;
      scheduleWrite({ r, c });
    });

    // 重建后恢复焦点
    if (pendingTableFocus) {
      const { r, c } = pendingTableFocus;
      pendingTableFocus = null;
      window.setTimeout(() => {
        const td = cellAt(r, c);
        if (td) {
          focusCell(td);
          view.dispatch({ selection: { anchor: this.pos } });
        }
      }, 0);
    }

    wrap.appendChild(table);
    return wrap;
  }

  /** 防止 CM 把 widget 内的键盘事件当作编辑器输入 */
  ignoreEvent(): boolean {
    return true;
  }
}
