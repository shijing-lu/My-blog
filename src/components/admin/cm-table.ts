/**
 * cm-table.ts —— Markdown 表格的「所见即所得」编辑 Widget（Obsidian 式）
 *
 * 交互：
 * - 表格在编辑区内直接渲染为可视化表格；点击任意单元格原地编辑（contenteditable）
 * - Tab / Shift+Tab 在单元格间跳转；最后一格 Tab / 任意格 Enter → 自动新建一行并跳入
 * - 空数据格 Backspace → 删除该行（保留表头与至少一行数据）
 * - 对齐来自分隔行（:--- / :---: / ---:）；单元格内 `|` 自动转义
 * - 编辑回写：单元格输入 300ms 防抖；离开表格时立即写回，
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

/** 是否为表格行（GFM 允许省略外侧的竖线） */
export function isTableRow(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && (t.includes('|') || t.startsWith('|'));
}

/** 拆分一行单元格（处理 \| 转义） */
export function splitRow(text: string): string[] {
  let t = text.trim().replace(/^\|/, '');
  const trailingEscape = t.match(/(\\+)\|$/)?.[1]?.length ?? 0;
  if (t.endsWith('|') && trailingEscape % 2 === 0) t = t.slice(0, -1);
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
  if (header.length !== sep.length || header.length === 0) return null;
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
    // 多余的列若被静默截断，下一次编辑会永久删除源码；退回源码编辑更安全。
    if (cells.length > header.length) return null;
    while (cells.length < header.length) cells.push('');
    rows.push(cells.slice(0, header.length));
  }
  return { header, aligns, rows };
}

export type TableOperation =
  | { type: 'insertRow'; at: number }
  | { type: 'deleteRow'; at: number }
  | { type: 'moveRow'; from: number; to: number }
  | { type: 'insertColumn'; at: number }
  | { type: 'deleteColumn'; at: number }
  | { type: 'moveColumn'; from: number; to: number }
  | { type: 'align'; at: number; align: TableAlign }
  | { type: 'sort'; at: number; direction: 'asc' | 'desc' };

/** 表格结构变更是纯函数：菜单和键盘共用，单次事务即可撤销。行号 0 为表头。 */
export function applyTableOperation(table: ParsedTable, op: TableOperation): ParsedTable | null {
  const next: ParsedTable = {
    header: [...table.header],
    aligns: [...table.aligns],
    rows: table.rows.map((row) => [...row]),
  };
  const cols = next.header.length;
  switch (op.type) {
    case 'insertRow':
      if (op.at < 0 || op.at > next.rows.length) return null;
      next.rows.splice(op.at, 0, Array(cols).fill(''));
      break;
    case 'deleteRow':
      if (op.at < 0 || op.at >= next.rows.length || next.rows.length <= 1) return null;
      next.rows.splice(op.at, 1);
      break;
    case 'moveRow': {
      if (op.from < 0 || op.from >= next.rows.length || op.to < 0 || op.to >= next.rows.length) return null;
      const [row] = next.rows.splice(op.from, 1);
      next.rows.splice(op.to, 0, row!);
      break;
    }
    case 'insertColumn':
      if (op.at < 0 || op.at > cols) return null;
      next.header.splice(op.at, 0, '');
      next.aligns.splice(op.at, 0, 'left');
      next.rows.forEach((row) => row.splice(op.at, 0, ''));
      break;
    case 'deleteColumn':
      if (op.at < 0 || op.at >= cols || cols <= 1) return null;
      next.header.splice(op.at, 1);
      next.aligns.splice(op.at, 1);
      next.rows.forEach((row) => row.splice(op.at, 1));
      break;
    case 'moveColumn': {
      if (op.from < 0 || op.from >= cols || op.to < 0 || op.to >= cols) return null;
      const move = <T,>(arr: T[]): void => {
        const [item] = arr.splice(op.from, 1);
        arr.splice(op.to, 0, item!);
      };
      move(next.header);
      move(next.aligns);
      next.rows.forEach(move);
      break;
    }
    case 'align':
      if (op.at < 0 || op.at >= cols) return null;
      next.aligns[op.at] = op.align;
      break;
    case 'sort':
      if (op.at < 0 || op.at >= cols) return null;
      next.rows.sort((a, b) => (a[op.at] ?? '').localeCompare(b[op.at] ?? '', 'zh-CN', { numeric: true }) * (op.direction === 'asc' ? 1 : -1));
      break;
  }
  return next;
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

/** 焦点按编辑器实例隔离，避免一张表重建后把光标送到另一张表。 */
const pendingTableFocus = new WeakMap<EditorView, { pos: number; r: number; c: number }>();

/** 请求重建后把焦点放到指定单元格 */
function requestTableFocus(view: EditorView, pos: number, r: number, c: number): void {
  pendingTableFocus.set(view, { pos, r, c });
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

    const commit = (next: ParsedTable, focus?: { r: number; c: number }): void => {
      // 防抖期间编辑器可能已被关闭或表格源码已被其它操作改写。
      if (!view.dom.isConnected || view.state.sliceDoc(this.pos, this.pos + this.raw.length) !== this.raw) return;
      const markdown = buildTableMarkdown(next);
      if (markdown === this.raw) return;
      if (focus) requestTableFocus(view, this.pos, focus.r, focus.c);
      view.dispatch({
        changes: { from: this.pos, to: this.pos + this.raw.length, insert: markdown },
        userEvent: 'md.table',
      });
    };

    const currentFocus = (): { r: number; c: number } | undefined => {
      const cell = document.activeElement as HTMLTableCellElement | null;
      if (!cell || !table.contains(cell) || cell.cellIndex < 0) return undefined;
      return { r: (cell.parentElement as HTMLTableRowElement).rowIndex, c: cell.cellIndex };
    };

    /** 防抖回写源码（重建后按 pendingTableFocus 恢复焦点） */
    let timer: number | null = null;
    const flushWrite = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      const data = collect();
      commit({ header: data.header, aligns, rows: data.rows }, currentFocus());
    };
    const scheduleWrite = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(flushWrite, 300);
    };
    // A surrounding column may be moved/merged before focus leaves this table.
    wrap.addEventListener('md-editor-flush', () => {
      if (timer !== null || pendingWhileMenuOpen) flushWrite();
    });

    const runOperation = (op: TableOperation, focus?: { r: number; c: number }): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      const data = collect();
      const next = applyTableOperation({ header: data.header, aligns, rows: data.rows }, op);
      if (next) commit(next, focus);
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

    // 边缘快速操作：行尾追加列、列底追加行。按钮在表格滚动容器内独立定位，
    // 不成为 table cell，因此 collect()/Markdown 序列化始终只看到真实数据格。
    const edge = document.createElement('div');
    edge.className = 'md-table-edge-layer';
    const rowButtons: HTMLButtonElement[] = [];
    const columnButtons: HTMLButtonElement[] = [];
    for (let r = 0; r < table.rows.length; r++) {
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'md-table-edge-button md-table-add-column';
      trigger.textContent = '+'; trigger.setAttribute('aria-label', `在第 ${r === 0 ? '表头' : `${r} 行`}右侧新增列`);
      trigger.title = '在右侧新增列';
      trigger.addEventListener('mousedown', (event) => event.preventDefault());
      trigger.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        const at = table.rows[0]!.cells.length;
        runOperation({ type: 'insertColumn', at }, { r, c: at });
      });
      rowButtons.push(trigger); edge.append(trigger);
    }
    for (let c = 0; c < table.rows[0]!.cells.length; c++) {
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'md-table-edge-button md-table-add-row';
      trigger.textContent = '+'; trigger.setAttribute('aria-label', `在第 ${c + 1} 列下方新增行`);
      trigger.title = '在下方新增行';
      trigger.addEventListener('mousedown', (event) => event.preventDefault());
      trigger.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        const at = table.rows.length - 1;
        runOperation({ type: 'insertRow', at }, { r: at + 1, c });
      });
      columnButtons.push(trigger); edge.append(trigger);
    }
    const positionEdges = (): void => {
      if (!wrap.isConnected) return;
      const rootRect = wrap.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const x = tableRect.right - rootRect.left + wrap.scrollLeft + 3;
      const y = tableRect.bottom - rootRect.top + wrap.scrollTop + 3;
      rowButtons.forEach((trigger, r) => {
        const rect = table.rows[r]!.getBoundingClientRect();
        trigger.style.left = `${x}px`;
        trigger.style.top = `${rect.top + rect.height / 2 - rootRect.top + wrap.scrollTop - 10}px`;
      });
      columnButtons.forEach((trigger, c) => {
        const rect = table.rows[0]!.cells[c]!.getBoundingClientRect();
        trigger.style.left = `${rect.left + rect.width / 2 - rootRect.left + wrap.scrollLeft - 10}px`;
        trigger.style.top = `${y}px`;
      });
    };
    const activate = (row: number, column: number): void => {
      rowButtons.forEach((trigger, index) => trigger.classList.toggle('is-active', index === row));
      columnButtons.forEach((trigger, index) => trigger.classList.toggle('is-active', index === column));
    };
    table.addEventListener('pointermove', (event) => {
      const cell = (event.target as Element).closest('td,th') as HTMLTableCellElement | null;
      if (cell) activate((cell.parentElement as HTMLTableRowElement).rowIndex, cell.cellIndex);
    });
    table.addEventListener('focusin', (event) => {
      const cell = (event.target as Element).closest('td,th') as HTMLTableCellElement | null;
      if (cell) activate((cell.parentElement as HTMLTableRowElement).rowIndex, cell.cellIndex);
    });
    wrap.addEventListener('pointerleave', () => activate(-1, -1));
    wrap.addEventListener('pointerenter', positionEdges);
    wrap.addEventListener('scroll', positionEdges, { passive: true });

    const cellAt = (r: number, c: number): HTMLTableCellElement | null => {
      const tr = table.rows[r];
      return tr ? (tr.cells[c] as HTMLTableCellElement | undefined) ?? null : null;
    };

    let menu: HTMLDivElement | null = null;
    let pendingWhileMenuOpen = false;
    const closeMenu = (savePending = true): void => {
      menu?.remove();
      menu = null;
      document.removeEventListener('pointerdown', outsideMenu, true);
      document.removeEventListener('keydown', escapeMenu, true);
      if (savePending && pendingWhileMenuOpen) flushWrite();
      pendingWhileMenuOpen = false;
    };
    const outsideMenu = (event: PointerEvent): void => {
      if (menu && !menu.contains(event.target as Node)) closeMenu();
    };
    const escapeMenu = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !menu) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    };
    const openMenu = (x: number, y: number, r: number, c: number): void => {
      closeMenu();
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
        pendingWhileMenuOpen = true;
      }
      const dataRows = table.rows.length - 1;
      const columns = table.rows[0]!.cells.length;
      const entries: Array<{ label: string; op: TableOperation; focus: { r: number; c: number }; enabled?: boolean }> = [
        { label: '上方插入行', op: { type: 'insertRow', at: Math.max(0, r - 1) }, focus: { r: Math.max(1, r), c } },
        { label: '下方插入行', op: { type: 'insertRow', at: r }, focus: { r: r + 1, c } },
        { label: '删除此行', op: { type: 'deleteRow', at: r - 1 }, focus: { r: Math.min(r, dataRows - 1), c }, enabled: r > 0 && dataRows > 1 },
        { label: '上移此行', op: { type: 'moveRow', from: r - 1, to: r - 2 }, focus: { r: r - 1, c }, enabled: r > 1 },
        { label: '下移此行', op: { type: 'moveRow', from: r - 1, to: r }, focus: { r: r + 1, c }, enabled: r > 0 && r < dataRows },
        { label: '左侧插入列', op: { type: 'insertColumn', at: c }, focus: { r, c } },
        { label: '右侧插入列', op: { type: 'insertColumn', at: c + 1 }, focus: { r, c: c + 1 } },
        { label: '删除此列', op: { type: 'deleteColumn', at: c }, focus: { r, c: Math.min(c, columns - 2) }, enabled: columns > 1 },
        { label: '左移此列', op: { type: 'moveColumn', from: c, to: c - 1 }, focus: { r, c: c - 1 }, enabled: c > 0 },
        { label: '右移此列', op: { type: 'moveColumn', from: c, to: c + 1 }, focus: { r, c: c + 1 }, enabled: c < columns - 1 },
        { label: '按此列升序', op: { type: 'sort', at: c, direction: 'asc' }, focus: { r, c }, enabled: dataRows > 1 },
        { label: '按此列降序', op: { type: 'sort', at: c, direction: 'desc' }, focus: { r, c }, enabled: dataRows > 1 },
        { label: '左对齐', op: { type: 'align', at: c, align: 'left' }, focus: { r, c } },
        { label: '居中对齐', op: { type: 'align', at: c, align: 'center' }, focus: { r, c } },
        { label: '右对齐', op: { type: 'align', at: c, align: 'right' }, focus: { r, c } },
      ];
      menu = document.createElement('div');
      menu.className = 'md-table-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', '表格操作');
      for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.role = 'menuitem';
        button.textContent = entry.label;
        button.disabled = entry.enabled === false;
        button.addEventListener('click', () => {
          runOperation(entry.op, entry.focus);
          closeMenu(false);
        });
        menu.appendChild(button);
      }
      document.body.appendChild(menu);
      const menuRect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menuRect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menuRect.height - 8))}px`;
      document.addEventListener('pointerdown', outsideMenu, true);
      document.addEventListener('keydown', escapeMenu, true);
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    };
    table.addEventListener('contextmenu', (event) => {
      const td = (event.target as HTMLElement).closest<HTMLTableCellElement>('td,th');
      if (!td || !table.contains(td)) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.clientX, event.clientY, (td.parentElement as HTMLTableRowElement).rowIndex, td.cellIndex);
    });

    /** 键盘导航与增删行 */
    table.addEventListener('keydown', (e) => {
      const td = e.target as HTMLTableCellElement;
      if (!td || !table.contains(td)) return;
      const r = td.parentElement ? (td.parentElement as HTMLTableRowElement).rowIndex : 0;
      const c = td.cellIndex;
      const dataRows = table.rows.length - 1;

      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const rect = td.getBoundingClientRect();
        openMenu(rect.left + 8, rect.bottom, r, c);
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (!e.shiftKey) {
          if (c === table.rows[0]!.cells.length - 1 && r === table.rows.length - 1) {
            // 最后一格 Tab → 追加一行并跳入首格
            runOperation({ type: 'insertRow', at: dataRows }, { r: dataRows + 1, c: 0 });
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
        runOperation({ type: 'insertRow', at: r }, { r: r + 1, c });
        return;
      }

      if (e.key === 'Backspace' && r > 0 && dataRows > 1) {
        const text = td.textContent ?? '';
        const sel = window.getSelection();
        const caretAtStart =
          text === '' || (sel && sel.isCollapsed && sel.anchorOffset === 0 && (sel.anchorNode === td || td.contains(sel.anchorNode)));
        if (caretAtStart) {
          e.preventDefault();
          runOperation({ type: 'deleteRow', at: r - 1 }, { r: Math.min(r, dataRows - 1), c });
        }
      }
    });

    /** 输入 → 防抖回写 */
    table.addEventListener('input', (e) => {
      const td = e.target as HTMLTableCellElement;
      if (!td || !table.contains(td)) return;
      scheduleWrite();
    });

    // 离开表格时立即回写，避免 300ms 防抖尚未结束就点击「完成」导致最后一个字丢失。
    table.addEventListener('focusout', (e) => {
      if (timer === null || pendingWhileMenuOpen) return;
      const next = e.relatedTarget as Node | null;
      if (!next || !table.contains(next)) flushWrite();
    });

    // 重建后恢复焦点
    const pending = pendingTableFocus.get(view);
    if (pending?.pos === this.pos) {
      const { r, c } = pending;
      pendingTableFocus.delete(view);
      window.setTimeout(() => {
        const td = cellAt(r, c);
        if (td) {
          focusCell(td);
          view.dispatch({ selection: { anchor: this.pos } });
        }
      }, 0);
    }

    wrap.append(table, edge);
    queueMicrotask(positionEdges);
    return wrap;
  }

  /** 防止 CM 把 widget 内的键盘事件当作编辑器输入 */
  ignoreEvent(): boolean {
    return true;
  }
}
