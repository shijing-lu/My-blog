/**
 * cm-live-preview.ts —— CodeMirror 6「所见即所得」扩展（Obsidian 式）
 *
 * 渲染策略（稳健优先）：
 * - 行内：隐藏 Markdown 标记（#、>、**、*、`、~~、链接 URL），正文套样式；
 * - 块级：代码围栏 → 代码块 Widget；图片 `![alt](url)` → 图片 Widget；
 * - 「光标/选区进入某块区间」时该块回显源码（可编辑），移出后恢复渲染；
 * - 所有区间保证不重叠（代码块行跳过行内渲染），构建异常有 try/catch 兜底，
 *   绝不因装饰错误冻结编辑器。
 */
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';

/** 隐藏范围（replace 为空，不占视觉空间，仍可编辑） */
const hide = Decoration.replace({});

/** 点击渲染块 → 光标移动到该块源码起点（触发选区重建 → 回显源码） */
function makeClickToPos(dom: HTMLElement, pos: number): void {
  dom.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const view = EditorView.findFromDOM(dom);
    if (view && pos >= 0) {
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
    return other.lang === this.lang && other.code === this.code;
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
    return true;
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
    return other.src === this.src && other.alt === this.alt;
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
    return true;
  }
}

/** 选区是否「位于/进入」某区间（点光标取包含起点、不包含终点） */
function selectionInside(ranges: ReadonlyArray<readonly [number, number]>, from: number, to: number): boolean {
  return ranges.some(([a, b]) => (a < to && b > from) || (a >= from && a < to));
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

  // 被代码块占用的行（行内/标题 pass 跳过）
  const blockedLines = new Set<number>();
  // 已做行级隐藏/样式的行（行内 pass 跳过）
  const noInline = new Set<number>();

  // ---- 代码围栏 → 代码块 Widget ----
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
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
        if (!selectionInside(sel, from, to)) {
          items.push({ from, to, deco: Decoration.replace({ widget: new CodeWidget(fence[1] ?? '', body.join('\n'), from) }) });
        }
        for (let k = i; k <= close; k += 1) blockedLines.add(k);
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }

  // ---- 标题 / 引用：隐藏标记 + 文本套样式（代码块行跳过） ----
  lines.forEach((line, idx) => {
    if (blockedLines.has(idx)) return;
    const head = line.text.match(/^(\s*)(#{1,6})\s+(.*)$/);
    if (head) {
      const level = head[2]!.length;
      const markerEnd = line.from + (head[1]?.length ?? 0) + level + 1;
      items.push({ from: line.from, to: markerEnd, deco: hide });
      items.push({ from: markerEnd, to: line.to, deco: Decoration.mark({ class: `cm-lp-heading cm-lp-h${level}` }) });
      noInline.add(idx);
      return;
    }
    const quote = line.text.match(/^(\s*)>\s?(.*)$/);
    if (quote) {
      const markerEnd = line.from + (quote[1]?.length ?? 0) + 1;
      items.push({ from: line.from, to: markerEnd, deco: hide });
      items.push({ from: markerEnd, to: line.to, deco: Decoration.mark({ class: 'cm-lp-quote-text' }) });
      noInline.add(idx);
    }
  });

  // ---- 行内：加粗 / 斜体 / 行内代码 / 删除线 / 链接 / 图片 ----
  const inlineRe =
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(\*\*)([^*\n]+)\*\*|(\*)([^*\n]+)\*|(`)([^`\n]+)`|(~~)([^~\n]+)~~|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  lines.forEach((line, idx) => {
    if (blockedLines.has(idx) || noInline.has(idx)) return;
    inlineRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(line.text))) {
      const base = line.from + m.index;
      const fullLen = m[0].length;
      const fullTo = base + fullLen;

      // 图片 ![alt](url)
      if (m[1] !== undefined && m[2] !== undefined) {
        if (!selectionInside(sel, base, fullTo)) {
          items.push({ from: base, to: fullTo, deco: Decoration.replace({ widget: new ImageWidget(m[2] ?? '', m[1] ?? '', base) }) });
        }
        continue;
      }

      if (m[3] !== undefined) {
        items.push({ from: base, to: base + 2, deco: hide });
        items.push({ from: base + 2, to: base + fullLen - 2, deco: Decoration.mark({ class: 'cm-lp-strong' }) });
        items.push({ from: base + fullLen - 2, to: fullTo, deco: hide });
      } else if (m[5] !== undefined) {
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + fullLen - 1, deco: Decoration.mark({ class: 'cm-lp-em' }) });
        items.push({ from: base + fullLen - 1, to: fullTo, deco: hide });
      } else if (m[7] !== undefined) {
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + fullLen - 1, deco: Decoration.mark({ class: 'cm-lp-inline-code' }) });
        items.push({ from: base + fullLen - 1, to: fullTo, deco: hide });
      } else if (m[9] !== undefined) {
        items.push({ from: base, to: base + 2, deco: hide });
        items.push({ from: base + 2, to: base + fullLen - 2, deco: Decoration.mark({ class: 'cm-lp-del' }) });
        items.push({ from: base + fullLen - 2, to: fullTo, deco: hide });
      } else if (m[11] !== undefined && m[12] !== undefined) {
        const textLen = m[11]!.length;
        const urlLen = m[12]!.length;
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + 1 + textLen, deco: Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': m[12]! } }) });
        items.push({ from: base + 1 + textLen, to: base + 1 + textLen + urlLen + 2, deco: hide });
      }
    }
  });

  // ---- 排序写入（保证非重叠） ----
  items.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of items) {
    builder.add(item.from, item.to, item.deco);
  }
  return builder.finish();
}

/** Live Preview 插件（文档 / 选区 / 视口变化时重建；异常兜底为空集） */
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.safeBuild(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.safeBuild(update.view);
      }
    }

    private safeBuild(view: EditorView): DecorationSet {
      try {
        return buildDecorations(view);
      } catch {
        return Decoration.none;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** 获取 Live Preview 扩展（加入编辑器 extensions） */
export function livePreview(): Extension {
  return livePreviewPlugin;
}
