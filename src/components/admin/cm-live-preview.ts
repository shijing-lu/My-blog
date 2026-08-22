/**
 * cm-live-preview.ts —— CodeMirror 6「所见即所得」扩展（Obsidian 式）
 *
 * 稳健设计：
 * - 仅做行内渲染：隐藏 Markdown 语法标记（#、>、**、*、`、~~、链接 URL），
 *   对正文套样式（加粗/斜体/行内代码/删除线/链接/标题/引用）。
 * - 装饰只随「文档变化 / 视口变化」重建（不随选区重建）——点击编辑器时装饰保持
 *   稳定，因此光标定位与鼠标点击永远准确。
 * - 无块级 Widget 替换（避免区间重叠导致 RangeSetBuilder 抛错冻结编辑器）。
 */
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';

/** 隐藏范围（replace 为空，不占视觉空间，仍可编辑） */
const hide = Decoration.replace({});

/** 构建全部装饰（纯文档驱动，稳定） */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const items: Array<{ from: number; to: number; deco: Decoration }> = [];

  const lines: Array<{ from: number; to: number; text: string }> = [];
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    lines.push({ from: line.from, to: line.to, text: line.text });
  }

  // 已做行级隐藏/样式的行（行内 pass 跳过，避免区间重叠）
  const noInline = new Set<number>();

  // ---- 标题 / 引用：隐藏标记 + 文本套样式 ----
  lines.forEach((line, idx) => {
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

  // ---- 行内：加粗 / 斜体 / 行内代码 / 删除线 / 链接 ----
  const inlineRe =
    /(\*\*)([^*\n]+)\*\*|(\*)([^*\n]+)\*|(`)([^`\n]+)`|(~~)([^~\n]+)~~|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  lines.forEach((line, idx) => {
    if (noInline.has(idx)) return;
    inlineRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(line.text))) {
      const base = line.from + m.index;
      const fullLen = m[0].length;
      const fullTo = base + fullLen;

      if (m[1] !== undefined) {
        items.push({ from: base, to: base + 2, deco: hide });
        items.push({ from: base + 2, to: base + fullLen - 2, deco: Decoration.mark({ class: 'cm-lp-strong' }) });
        items.push({ from: base + fullLen - 2, to: fullTo, deco: hide });
      } else if (m[3] !== undefined) {
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + fullLen - 1, deco: Decoration.mark({ class: 'cm-lp-em' }) });
        items.push({ from: base + fullLen - 1, to: fullTo, deco: hide });
      } else if (m[5] !== undefined) {
        items.push({ from: base, to: base + 1, deco: hide });
        items.push({ from: base + 1, to: base + fullLen - 1, deco: Decoration.mark({ class: 'cm-lp-inline-code' }) });
        items.push({ from: base + fullLen - 1, to: fullTo, deco: hide });
      } else if (m[7] !== undefined) {
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

/** Live Preview 插件（仅文档/视口变化时重建） */
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
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
