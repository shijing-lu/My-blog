import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { CALLOUT_LABELS, CALLOUT_TYPES, MARK_LABELS, MARK_VARIANTS } from '../../lib/markdown-format-catalog';
import { calloutTemplate, collapseTemplate, columnsTemplate, galleryTemplate, inlineTemplate, tableTemplate, tabsTemplate } from '../../lib/markdown-context-templates';
import type { MarkdownTemplate } from '../../lib/markdown-context-templates';

type CustomPanel = 'callout' | 'gallery' | 'tabs';
interface MenuItem {
  label: string;
  action?: () => void | Promise<void>;
  children?: MenuItem[];
  custom?: CustomPanel;
  disabled?: boolean;
  title?: string;
  separator?: boolean;
}
interface Context {
  view: EditorView;
  parent?: EditorView;
  doc: Text;
  from: number;
  to: number;
  pointer: number;
}

/** Block creation never runs inside a code fence, list item or table row. */
function blockAllowed(context: Context): boolean {
  const source = context.doc.toString();
  const line = context.doc.lineAt(context.pointer).text;
  if (/^\s*(?:[-*+]\s|\d+\.\s|>|\|)/.test(line)) return false;
  let fence: { marker: string; length: number } | null = null;
  for (const text of source.slice(0, context.pointer).split('\n')) {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (!fence) {
      if (opening) fence = { marker: opening[1]![0]!, length: opening[1]!.length };
    } else if (new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}\\s*$`).test(text)) fence = null;
  }
  return !fence;
}

function position(element: HTMLElement, x: number, y: number, parent?: HTMLElement): void {
  const { width, height } = element.getBoundingClientRect();
  const padding = 8;
  const left = parent && x + width > innerWidth - padding
    ? parent.getBoundingClientRect().left - width + 3 : x;
  element.style.left = `${Math.max(padding, Math.min(left, innerWidth - width - padding))}px`;
  element.style.top = `${Math.max(padding, Math.min(y, innerHeight - height - padding))}px`;
}

export class MarkdownContextMenu {
  private panels: HTMLElement[] = [];
  private portalRoot: HTMLElement = document.body;
  private context: Context | null = null;
  private hoverTimer = 0;
  private previousFocus: HTMLElement | null = null;

  private outside = (event: PointerEvent): void => {
    if (!this.panels.some((panel) => panel.contains(event.target as Node))) this.close(false);
  };
  private onDocumentKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.panels.length === 0) return;
    event.preventDefault();
    this.close(true);
  };
  private onScroll = (event: Event): void => {
    if (!this.panels.some((panel) => panel.contains(event.target as Node))) this.close(false);
  };

  open(event: MouseEvent, view: EditorView, parent?: EditorView): boolean {
    if ((event.target as Element | null)?.closest('.md-table-widget')) return false;
    if ((event.target as Element | null)?.closest('.cm-visual-directive, .cm-columns-widget') && !parent) return false;
    event.preventDefault();
    event.stopPropagation();
    const selection = view.state.selection.main;
    const pointer = selection.empty && event.clientX + event.clientY > 0
      ? (view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? selection.head)
      : selection.head;
    this.show({
      view, parent, doc: view.state.doc,
      from: selection.empty ? pointer : selection.from,
      to: selection.empty ? pointer : selection.to,
      pointer,
    }, event.clientX || view.coordsAtPos(pointer)?.left || view.dom.getBoundingClientRect().left,
    event.clientY || view.coordsAtPos(pointer)?.bottom || view.dom.getBoundingClientRect().top);
    return true;
  }

  openAtCaret(view: EditorView, parent?: EditorView): void {
    const pointer = view.state.selection.main.head;
    const rect = view.coordsAtPos(pointer) ?? view.dom.getBoundingClientRect();
    const selection = view.state.selection.main;
    this.show({ view, parent, doc: view.state.doc, from: selection.from, to: selection.to, pointer }, rect.left, rect.bottom);
  }

  private show(context: Context, x: number, y: number): void {
    this.close(false);
    this.context = context;
    // 原位编辑也会出现在模态 dialog 中；菜单必须属于同一顶层容器，
    // 否则 append 到 body 后会被 dialog 的 top layer 遮住。
    this.portalRoot = context.view.dom.closest('dialog[open]') ?? document.body;
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.renderItems(0, this.rootItems(context), x, y, 'Markdown 右键菜单');
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.onDocumentKey, true);
    document.addEventListener('scroll', this.onScroll, true);
  }

  close(restoreFocus = false): void {
    window.clearTimeout(this.hoverTimer);
    for (const panel of this.panels) panel.remove();
    this.panels = [];
    this.context = null;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.onDocumentKey, true);
    document.removeEventListener('scroll', this.onScroll, true);
    if (restoreFocus) this.previousFocus?.focus({ preventScroll: true });
    this.previousFocus = null;
  }

  destroy(): void { this.close(false); }

  private valid(context: Context): boolean {
    return context.view.dom.isConnected && context.view.state.doc === context.doc;
  }

  private write(context: Context, from: number, to: number, insert: string, anchor: number, head = anchor): void {
    if (!this.valid(context)) return;
    context.view.dispatch({
      changes: { from, to, insert },
      selection: { anchor, head },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.context-menu',
    });
    context.view.focus();
  }

  private addBlock(context: Context, block: MarkdownTemplate): void {
    if (!blockAllowed(context) || !this.valid(context)) return;
    const pos = context.pointer;
    const prev = pos > 0 ? context.doc.sliceString(pos - 1, pos) : '';
    const next = pos < context.doc.length ? context.doc.sliceString(pos, pos + 1) : '';
    const prefix = pos === 0 ? '' : prev === '\n' ? '\n' : '\n\n';
    const suffix = pos === context.doc.length ? '' : next === '\n' ? '\n' : '\n\n';
    const start = pos + prefix.length;
    this.write(context, pos, pos, `${prefix}${block.source}${suffix}`,
      start + block.focusFrom, start + block.focusTo);
  }

  private format(context: Context, kind: Parameters<typeof inlineTemplate>[0], variant?: Parameters<typeof inlineTemplate>[2]): void {
    if (context.from === context.to || !this.valid(context)) return;
    const selected = context.doc.sliceString(context.from, context.to);
    if (selected.includes('\n')) return;
    const insert = inlineTemplate(kind, selected, variant);
    this.write(context, context.from, context.to, insert,
      context.from + insert.length, context.from + insert.length);
  }

  private rootItems(context: Context): MenuItem[] {
    const selected = context.from < context.to;
    const inlineAllowed = selected && !context.doc.sliceString(context.from, context.to).includes('\n');
    const canBlock = !selected && blockAllowed(context);
    const inline: MenuItem[] = [
      { label: '荧光高亮', disabled: !inlineAllowed, children: MARK_VARIANTS.map((variant) => ({
        label: MARK_LABELS[variant], action: () => this.format(context, 'mark', variant),
      })) },
      { label: '黑幕', disabled: !inlineAllowed, action: () => this.format(context, 'spoiler') },
      { label: '加粗', disabled: !inlineAllowed, action: () => this.format(context, 'strong') },
      { label: '斜体', disabled: !inlineAllowed, action: () => this.format(context, 'em') },
      { label: '下划线', disabled: !inlineAllowed, action: () => this.format(context, 'underline') },
      { label: '删除线', disabled: !inlineAllowed, action: () => this.format(context, 'strike') },
    ];
    const blocks: MenuItem[] = [
      { label: '普通引用', disabled: !canBlock, action: () => this.addBlock(context, { source: '> 引用内容', focusFrom: 2, focusTo: 6 }) },
      { label: 'Callout 引用', disabled: !canBlock, custom: 'callout' },
      { label: '表格', disabled: !canBlock, action: () => this.addBlock(context, tableTemplate()) },
      { label: '分栏', disabled: !canBlock, children: [
        { label: '两栏', action: () => this.addBlock(context, columnsTemplate(2)) },
        { label: '三栏', action: () => this.addBlock(context, columnsTemplate(3)) },
      ] },
      { label: '图片画廊', disabled: !canBlock, custom: 'gallery' },
      { label: '选项卡组', disabled: !canBlock, custom: 'tabs' },
      { label: '折叠面板', disabled: !canBlock, children: [
        { label: '默认全部折叠', action: () => this.addBlock(context, collapseTemplate(false, false)) },
        { label: '默认全部展开', action: () => this.addBlock(context, collapseTemplate(false, true)) },
        { label: '互斥折叠', action: () => this.addBlock(context, collapseTemplate(true, false)) },
        { label: '互斥且默认展开', action: () => this.addBlock(context, collapseTemplate(true, true)) },
      ] },
    ];
    return [
      { label: '新增链接', action: () => this.link(context) },
      { label: '段落设置', children: selected ? inline : blocks },
      { label: '文本格式', disabled: !selected, children: inline },
      { separator: true, label: '' },
      { label: '剪切', disabled: !selected, action: () => this.cut(context) },
      { label: '复制', disabled: !selected, action: () => this.copy(context) },
      { label: '粘贴', action: () => this.paste(context) },
      { label: '全选', action: () => { if (this.valid(context)) { context.view.dispatch({ selection: { anchor: 0, head: context.doc.length } }); context.view.focus(); } } },
    ];
  }

  private link(context: Context): void {
    if (!this.valid(context)) return;
    const selected = context.doc.sliceString(context.from, context.to) || '链接文字';
    const insert = `[${selected}](https://)`;
    const at = context.from + insert.length - 1;
    this.write(context, context.from, context.to, insert, at - 8, at);
  }

  private async copy(context: Context): Promise<void> {
    const text = context.doc.sliceString(context.from, context.to);
    if (text) await navigator.clipboard.writeText(text);
  }
  private async cut(context: Context): Promise<void> {
    await this.copy(context);
    this.write(context, context.from, context.to, '', context.from);
  }
  private async paste(context: Context): Promise<void> {
    const text = await navigator.clipboard.readText();
    this.write(context, context.from, context.to, text, context.from + text.length);
  }

  private renderItems(level: number, items: MenuItem[], x: number, y: number, label: string, parent?: HTMLElement): void {
    this.removeFrom(level);
    const menu = document.createElement('div');
    menu.className = 'md-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    menu.dataset.level = String(level);
    for (const item of items) {
      if (item.separator) { const hr = document.createElement('div'); hr.className = 'md-context-divider'; hr.setAttribute('role', 'separator'); menu.append(hr); continue; }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-context-item';
      button.role = 'menuitem';
      button.disabled = !!item.disabled;
      button.title = item.title ?? '';
      button.append(document.createTextNode(item.label));
      if (item.children || item.custom) {
        button.setAttribute('aria-haspopup', 'menu');
        const arrow = document.createElement('span'); arrow.className = 'md-context-arrow'; arrow.textContent = '›'; button.append(arrow);
      }
      const expand = (focus: boolean): void => {
        if (item.disabled || (!item.children && !item.custom)) return;
        button.setAttribute('aria-expanded', 'true');
        const rect = button.getBoundingClientRect();
        if (item.custom) this.renderCustom(level + 1, item.custom, rect.right - 3, rect.top, button);
        else this.renderItems(level + 1, item.children!, rect.right - 3, rect.top, item.label, button);
        if (focus) this.panels[level + 1]?.querySelector<HTMLElement>('button:not(:disabled), input, select')?.focus({ preventScroll: true });
      };
      button.addEventListener('pointerenter', () => {
        window.clearTimeout(this.hoverTimer);
        if (item.children || item.custom) this.hoverTimer = window.setTimeout(() => expand(false), 90);
        else this.removeFrom(level + 1);
      });
      button.addEventListener('click', () => {
        if (item.children || item.custom) expand(true);
        else if (item.action) this.invoke(item.action);
      });
      button.addEventListener('keydown', (event) => {
        const keys = [...menu.querySelectorAll<HTMLButtonElement>('.md-context-item:not(:disabled)')];
        const index = keys.indexOf(button);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          keys[(index + (event.key === 'ArrowDown' ? 1 : -1) + keys.length) % keys.length]?.focus({ preventScroll: true });
        } else if (event.key === 'ArrowRight' && (item.children || item.custom)) { event.preventDefault(); expand(true); }
        else if (event.key === 'ArrowLeft' && level > 0) { event.preventDefault(); this.removeFrom(level); parent?.focus({ preventScroll: true }); }
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (item.children || item.custom) expand(true);
          else if (item.action) this.invoke(item.action);
        } else if (event.key === 'Tab') this.close(false);
      });
      menu.append(button);
    }
    this.portalRoot.append(menu);
    this.panels[level] = menu;
    position(menu, x, y, parent);
    if (level === 0) menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  private invoke(action: () => void | Promise<void>): void {
    this.close(false);
    try { void Promise.resolve(action()).catch((error) => console.error('[MarkdownContextMenu] 操作失败', error)); }
    catch (error) { console.error('[MarkdownContextMenu] 操作失败', error); }
  }

  private removeFrom(level: number): void {
    for (let i = this.panels.length - 1; i >= level; i -= 1) this.panels[i]?.remove();
    this.panels.length = level;
    const prior = this.panels[level - 1];
    for (const button of prior?.querySelectorAll('[aria-expanded]') ?? []) button.setAttribute('aria-expanded', 'false');
  }

  private renderCustom(level: number, kind: CustomPanel, x: number, y: number, parent: HTMLElement): void {
    this.removeFrom(level);
    const context = this.context;
    if (!context) return;
    const panel = document.createElement('div');
    panel.className = 'md-context-menu md-context-custom';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', kind === 'callout' ? 'Callout 类型' : kind === 'gallery' ? '图片画廊格式' : '选项卡组格式');
    const heading = document.createElement('strong');
    heading.className = 'md-context-heading';
    heading.textContent = kind === 'callout' ? 'Callout 引用' : kind === 'gallery' ? '图片画廊' : '选项卡组';
    panel.append(heading);
    const field = (label: string, control: HTMLElement): HTMLElement => {
      const wrap = document.createElement('label'); wrap.className = 'md-context-field';
      const caption = document.createElement('span'); caption.textContent = label;
      wrap.append(caption, control); panel.append(wrap); return control;
    };
    const option = (label: string, action: () => void): void => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'md-context-item';
      button.textContent = label; button.setAttribute('role', 'menuitem');
      button.addEventListener('click', () => this.invoke(action)); panel.append(button);
    };
    if (kind === 'callout') {
      const fold = document.createElement('select');
      for (const [value, label] of [['', '普通'], ['+', '可折叠 · 默认展开'], ['-', '可折叠 · 默认收起']]) {
        const item = document.createElement('option'); item.value = value!; item.textContent = label!; fold.append(item);
      }
      field('折叠状态', fold);
      for (const type of CALLOUT_TYPES) option(`${CALLOUT_LABELS[type]} · ${type}`, () => this.addBlock(context, calloutTemplate(type, fold.value as '' | '+' | '-')));
    } else if (kind === 'gallery') {
      const cols = document.createElement('select');
      for (let i = 1; i <= 6; i += 1) { const item = document.createElement('option'); item.value = String(i); item.textContent = `${i} 列`; item.selected = i === 3; cols.append(item); }
      const ratio = document.createElement('select');
      for (const value of ['16/10', '16/9', '3/4', '1/1', 'custom']) { const item = document.createElement('option'); item.value = value; item.textContent = value === 'custom' ? '自定义…' : value; ratio.append(item); }
      const custom = document.createElement('input'); custom.type = 'text'; custom.placeholder = '例如 4/3'; custom.value = '4/3'; custom.hidden = true;
      ratio.addEventListener('change', () => { custom.hidden = ratio.value !== 'custom'; });
      const fit = document.createElement('select');
      for (const value of ['cover', 'contain']) { const item = document.createElement('option'); item.value = value; item.textContent = value === 'cover' ? '裁切填满' : '完整显示'; fit.append(item); }
      field('每行列数', cols); field('图片比例', ratio); panel.append(custom); field('显示方式', fit);
      const create = document.createElement('button'); create.type = 'button'; create.className = 'md-context-item'; create.textContent = '创建图片画廊';
      create.addEventListener('click', () => {
        try {
          const block = galleryTemplate({ columns: Number(cols.value), aspect: ratio.value === 'custom' ? custom.value : ratio.value, fit: fit.value as 'cover' | 'contain' });
          this.invoke(() => this.addBlock(context, block));
        } catch { custom.setCustomValidity('请输入正整数宽高比，如 4/3'); custom.reportValidity(); custom.focus(); }
      });
      custom.addEventListener('input', () => custom.setCustomValidity(''));
      panel.append(create);
    } else {
      const stableId = document.createElement('input'); stableId.type = 'text'; stableId.placeholder = '留空为独立组；同名组联动';
      field('同步组 ID（可选）', stableId);
      for (const count of [2, 3] as const) {
        const create = document.createElement('button'); create.type = 'button'; create.className = 'md-context-item'; create.textContent = `创建${count === 2 ? '两' : '三'}项选项卡`;
        create.addEventListener('click', () => {
          try { const block = tabsTemplate(count, stableId.value.trim()); this.invoke(() => this.addBlock(context, block)); }
          catch { stableId.setCustomValidity('ID 只能使用字母、数字、下划线和短横线'); stableId.reportValidity(); stableId.focus(); }
        });
        panel.append(create);
      }
      stableId.addEventListener('input', () => stableId.setCustomValidity(''));
    }
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' && (event.target === panel || event.target === panel.querySelector('button'))) {
        event.preventDefault(); this.removeFrom(level); parent.focus({ preventScroll: true });
      }
    });
    this.portalRoot.append(panel);
    this.panels[level] = panel;
    position(panel, x, y, parent);
  }
}
