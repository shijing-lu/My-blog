/**
 * cm-live-preview.ts —— CodeMirror 6「所见即所得」扩展（Obsidian 式）
 *
 * 架构：同一份 MDX 源码，
 * - 行内：隐藏 Markdown 语法标记（**、*、`、~~、链接 URL、图片语法），对正文套样式；
 * - 块级：代码围栏 / 引用 / GFM 表格 / admonition 指令 / 图片 → 渲染为块级 Widget；
 * - 光标所在块（或选区相交）回到源码态，便于编辑。
 * 渲染使用 unified（remark→rehype→stringify，processSync 同步执行）。
 */
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

/** 同步 Markdown → HTML（小片段用，开销可控） */
const mdProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify);
function mdToHtmlSync(src: string): string {
  try {
    return String(mdProcessor.processSync(src));
  } catch {
    return '';
  }
}

/** HTML 转义 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 隐藏范围（replace 为空 widget，不占视觉空间） */
const hide = Decoration.replace({});

/** 点击渲染块 → 把光标移动到该块源码起点（Obsidian 式交互） */
function makeClickToPos(dom: HTMLElement, pos: number): void {
  if (pos < 0) return;
  dom.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const view = EditorView.findFromDOM(dom);
    if (view) {
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    }
  });
}

/** 代码块 Widget */
class CodeWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: CodeWidget): boolean {
    return other.lang === this.lang && other.code === this.code && other.pos === this.pos;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-block cm-lp-code';
    if (this.lang) {
      const tag = document.createElement('span');
      tag.className = 'cm-lp-code-lang';
      tag.textContent = this.lang;
      wrap.appendChild(tag);
    }
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = this.code;
    pre.appendChild(code);
    wrap.appendChild(pre);
    makeClickToPos(wrap, this.pos);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 通用 HTML 块 Widget（引用 / 表格 / admonition / 标题） */
class HtmlWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly className: string,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: HtmlWidget): boolean {
    return other.html === this.html && other.className === this.className && other.pos === this.pos;
  }

  toDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = `cm-lp-block ${this.className}`;
    div.innerHTML = this.html;
    makeClickToPos(div, this.pos);
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 图片 Widget */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.pos === this.pos;
  }

  toDOM(): HTMLElement {
    const fig = document.createElement('figure');
    fig.className = 'cm-lp-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    fig.appendChild(img);
    if (this.alt) {
      const cap = document.createElement('figcaption');
      cap.textContent = this.alt;
      fig.appendChild(cap);
    }
    makeClickToPos(fig, this.pos);
    return fig;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** admonition 标签文案 */
const ADMONITION_LABELS: Record<string, string> = {
  note: '备注',
  tip: '提示',
  warning: '注意',
  danger: '危险',
  info: '信息',
};

/** 构建 admonition HTML（复用全局 .admonition 样式） */
function admonitionHtml(type: string, title: string, body: string): string {
  const label = title || (ADMONITION_LABELS[type] ?? '信息');
  return `<aside class="admonition admonition-${type}" data-admonition="${type}" role="note"><div class="admonition-title"><span class="admonition-icon" aria-hidden="true">!</span><span class="font-medium">${esc(label)}</span></div><div class="admonition-body">${mdToHtmlSync(body)}</div></aside>`;
}

/** 选区是否与区间相交（相交 → 显示源码） */
function intersectsSelection(ranges: ReadonlyArray<readonly [number, number]>, from: number, to: number): boolean {
  return ranges.some(([a, b]) => from < b && to > a);
}

/** 构建全部装饰 */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const sel = view.state.selection.ranges.map((r) => [r.from, r.to] as const);
  const items: Array<{ from: number; to: number; deco: Decoration }> = [];

  const lines: Array<{ from: number; to: number; text: string }> = [];
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    lines.push({ from: line.from, to: line.to, text: line.text });
  }

  // 被块级占用的行号集合（行内 pass 跳过）
  const blockedLines = new Set<number>();

  // ---- 块级扫描：代码围栏 / admonition / GFM 表格 ----
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let consumed = 0;

    // 代码围栏
    const fence = line.text.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      let close = -1;
      while (j < lines.length) {
        if (/^```\s*$/.test(lines[j]!.text)) {
          close = j;
          break;
        }
        body.push(lines[j]!.text);
        j += 1;
      }
      if (close >= 0) {
        const from = line.from;
        const to = lines[close]!.to + 1;
        if (!intersectsSelection(sel, from, to)) {
          items.push({ from, to, deco: Decoration.replace({ widget: new CodeWidget(fence[1] ?? '', body.join('\n'), from) }) });
        }
        for (let k = i; k <= close; k += 1) blockedLines.add(k);
        consumed = close + 1;
      }
    }

    // admonition 指令
    if (consumed === 0) {
      const adm = line.text.match(/^:::(note|tip|warning|danger|info)\b\s*(.*)$/);
      if (adm) {
        const body: string[] = [];
        let j = i + 1;
        let close = -1;
        while (j < lines.length) {
          if (/^:::\s*$/.test(lines[j]!.text)) {
            close = j;
            break;
          }
          body.push(lines[j]!.text);
          j += 1;
        }
        if (close >= 0) {
          const from = line.from;
          const to = lines[close]!.to + 1;
          if (!intersectsSelection(sel, from, to)) {
            const html = admonitionHtml(adm[1]!, adm[2]?.trim() ?? '', body.join('\n'));
            items.push({ from, to, deco: Decoration.replace({ widget: new HtmlWidget(html, 'cm-lp-admonition', from) }) });
          }
          for (let k = i; k <= close; k += 1) blockedLines.add(k);
          consumed = close + 1;
        }
      }
    }

    // GFM 表格
    if (consumed === 0 && line.text.trim().startsWith('|')) {
      const rows: string[] = [line.text];
      let j = i + 1;
      while (j < lines.length && lines[j]!.text.trim().startsWith('|')) {
        rows.push(lines[j]!.text);
        j += 1;
      }
      if (rows.length >= 2) {
        const from = line.from;
        const to = lines[j - 1]!.to + 1;
        if (!intersectsSelection(sel, from, to)) {
          items.push({ from, to, deco: Decoration.replace({ widget: new HtmlWidget(mdToHtmlSync(rows.join('\n')), 'cm-lp-table', from) }) });
        }
        for (let k = i; k < j; k += 1) blockedLines.add(k);
        consumed = j;
      }
    }

    i = consumed > 0 ? consumed : i + 1;
  }

  // ---- 行级：标题 / 引用（隐藏标记 + 文本套样式，保持可编辑；选区相交则显源码） ----
  lines.forEach((line, idx) => {
    if (blockedLines.has(idx)) return;
    const head = line.text.match(/^(\s*)(#{1,6})\s+(.*)$/);
    if (head && !intersectsSelection(sel, line.from, line.to)) {
      const level = head[2]!.length;
      const markerEnd = line.from + (head[1]?.length ?? 0) + level + 1;
      // 隐藏「#」标记
      items.push({ from: line.from, to: markerEnd, deco: hide });
      // 标题文本套样式（仍是可编辑文本）
      items.push({ from: markerEnd, to: line.to, deco: Decoration.mark({ class: `cm-lp-heading cm-lp-h${level}` }) });
      return;
    }
    const quote = line.text.match(/^(\s*)>\s?(.*)$/);
    if (quote && !intersectsSelection(sel, line.from, line.to)) {
      const markerEnd = line.from + (quote[1]?.length ?? 0) + 1;
      // 隐藏「>」标记
      items.push({ from: line.from, to: markerEnd, deco: hide });
      // 引用文本套样式
      items.push({ from: markerEnd, to: line.to, deco: Decoration.mark({ class: 'cm-lp-quote-text' }) });
    }
  });

  // ---- 行内：加粗 / 斜体 / 行内代码 / 删除线 / 链接 / 图片 ----
  const inlineRe =
    /(\*\*)([^*\n]+)\*\*|(\*)([^*\n]+)\*|(`)([^`\n]+)`|(~~)([^~\n]+)~~|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  lines.forEach((line, idx) => {
    if (blockedLines.has(idx)) return;
    inlineRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(line.text))) {
      const base = line.from + m.index;
      const fullLen = m[0].length;
      const fullFrom = base;
      const fullTo = base + fullLen;

      // 图片 ![alt](url)
      if (m[9] !== undefined && m[10] !== undefined) {
        if (!intersectsSelection(sel, fullFrom, fullTo)) {
          items.push({ from: fullFrom, to: fullTo, deco: Decoration.replace({ widget: new ImageWidget(m[10] ?? '', m[9] ?? '', fullFrom) }) });
        }
        continue;
      }
      if (intersectsSelection(sel, fullFrom, fullTo)) continue;

      if (m[1] !== undefined) {
        // **bold**
        items.push({ from: base, to: base + 2, deco: hide });
        items.push({ from: base + 2, to: base + fullLen - 2, deco: Decoration.mark({ class: 'cm-lp-strong' }) });
        items.push({ from: base + fullLen - 2, to: fullTo, deco: hide });
      } else if (m[3] !== undefined) {
        // *em*
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + fullLen - 1, deco: Decoration.mark({ class: 'cm-lp-em' }) });
        items.push({ from: base + fullLen - 1, to: fullTo, deco: hide });
      } else if (m[5] !== undefined) {
        // `code`
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + fullLen - 1, deco: Decoration.mark({ class: 'cm-lp-inline-code' }) });
        items.push({ from: base + fullLen - 1, to: fullTo, deco: hide });
      } else if (m[7] !== undefined) {
        // ~~del~~
        items.push({ from: base, to: base + 2, deco: hide });
        items.push({ from: base + 2, to: base + fullLen - 2, deco: Decoration.mark({ class: 'cm-lp-del' }) });
        items.push({ from: base + fullLen - 2, to: fullTo, deco: hide });
      } else if (m[11] !== undefined && m[12] !== undefined) {
        // [text](url)
        const textLen = m[11]!.length;
        const urlLen = m[12]!.length;
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + 1 + textLen, deco: Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': m[12]! } }) });
        items.push({ from: base + 1 + textLen, to: base + 1 + textLen + urlLen + 2, deco: hide });
      }
    }
  });

  // ---- 按起始位置排序后写入 builder（保证不重叠） ----
  items.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of items) {
    builder.add(item.from, item.to, item.deco);
  }
  return builder.finish();
}

/** Live Preview 插件 */
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** 获取 Live Preview 扩展（加入编辑器 extensions） */
export function livePreview(): Extension {
  return livePreviewPlugin;
}
