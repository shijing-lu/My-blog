/**
 * cm-wysiwyg.ts —— CodeMirror 6「单栏所见即所得」扩展（Obsidian 即时渲染式）
 *
 * 在 cm-live-preview（文章写作台用）基础上增强为完整 WYSIWYG：
 * - 数学公式：`$…$` 行内 / `$$…$$` 块级 → KaTeX 实时渲染（静态 import katex，
 *   本模块由 MarkdownEditor 在 wysiwyg 模式下动态 import —— 写作台不加载、零负担）；
 * - 列表：无序 marker → 圆点 widget（按嵌套深度分级 •/◦/▪）；有序 → 数字 widget；
 *   任务列表 → 可勾选 checkbox（点击直接改写源码 `[ ]`↔`[x]`）；
 * - 标题/引用行内的行内标记（粗体/斜体/公式/链接等）也实时渲染
 *   （cm-live-preview 对标题/引用行整体跳过行内渲染，标题含公式时无法显示）；
 * - 点击任何渲染块 → 回显源码编辑，光标移出后恢复渲染（selectionInside）。
 *
 * 架构铁律（与 cm-live-preview 相同，勿回退）：
 * - 跨行 Decoration.replace 必须由 StateField 提供（ViewPlugin 会抛
 *   "Decorations that replace line breaks may not be specified via plugins" → 白屏）；
 * - 装饰区间互斥：靠「行内 occupied 区间表」防止正则匹配互相重叠
 *   （例：`* *em*` 的斜体会撞上列表 marker widget），任何漏网重叠会令
 *   RangeSetBuilder 抛错 → safeBuild 兜底为空集（降级为纯源码显示，绝不白屏）；
 * - 性能决策：docChanged/selection 变化均全量重建（与生产写作台 cm-live-preview
 *   同策略，已在 243KB 级文章上验证流畅）；KaTeX 只在 widget 首次 toDOM 或
 *   内容变化时真正渲染（eq 复用 DOM），全量重建本身只是轻量对象分配。
 */
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { makeClickToPos, selectionInside } from './cm-live-preview';
// katex 必须静态 import（勿改回 import('katex')）：
// 1) vite build 会把 katex 并入本模块所属 chunk，随 MarkdownEditor 的动态 import 按需加载，
//    写作台（非 wysiwyg 模式）不加载本模块 → 零 katex 负担；
// 2) vite dev 下 import('katex') 会走 dep-discovery 挂起路径（实测永久 pending 不 settle），
//    静态 import 走普通模块图，dev/prod 行为一致。
import katex from 'katex';

/** 隐藏范围（replace 为空，不占视觉空间，仍可编辑） */
const hide = Decoration.replace({});

/** 行内标记正则（与 cm-live-preview 保持一致语义：粗/斜/码/删/链接/图片） */
const inlineRe =
  /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(\*\*)([^*\n]+)\*\*|(\*)([^*\n]+)\*|(`)([^`\n]+)`|(~~)([^~\n]+)~~|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/* ================= Widget ================= */

/** KaTeX 公式 Widget（display=true 为块级 $$…$$，false 为行内 $…$） */
class KatexWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: KatexWidget): boolean {
    return other.src === this.src && other.display === this.display;
  }

  toDOM(): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-wy-math cm-wy-math-display' : 'cm-wy-math cm-wy-math-inline';
    try {
      el.innerHTML = katex.renderToString(this.src, {
        displayMode: this.display,
        throwOnError: false,
        strict: false,
        output: 'htmlAndMathml',
      });
    } catch {
      el.textContent = this.src;
      el.classList.add('cm-wy-math-err');
    }
    makeClickToPos(el, 0); // makeClickToPos 内部用 posAtDOM 动态定位，不依赖陈旧闭包
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** 无序列表 marker Widget（depth 按缩进分级：0→• 1→◦ 2+→▪） */
class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }

  eq(other: BulletWidget): boolean {
    return other.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = `cm-wy-bullet cm-wy-bullet-d${this.depth}`;
    s.textContent = ['•', '◦', '▪'][this.depth] ?? '•';
    return s;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 有序列表 marker Widget（保留原始数字与分隔符） */
class NumWidget extends WidgetType {
  constructor(
    readonly num: string,
    readonly delim: string,
  ) {
    super();
  }

  eq(other: NumWidget): boolean {
    return other.num === this.num && other.delim === this.delim;
  }

  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'cm-wy-num';
    s.textContent = `${this.num}${this.delim}`;
    return s;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 任务列表 checkbox Widget：点击直接改写源码 [ ] ↔ [x] */
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-wy-checkbox';
    box.addEventListener('change', () => {
      const view = EditorView.findFromDOM(box);
      if (!view) return;
      try {
        // posAtDOM 动态定位（widget 可随编辑移动，不能缓存 pos）
        const pos = view.posAtDOM(box, 0);
        const cur = view.state.doc.sliceString(pos, pos + 3);
        if (/^\[[ xX]\]$/.test(cur)) {
          view.dispatch({ changes: { from: pos, to: pos + 3, insert: this.checked ? '[ ]' : '[x]' } });
          view.focus();
        }
      } catch {
        /* 位置查询失败：忽略本次点击 */
      }
    });
    return box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/* ================= 词法辅助 ================= */

/** 找非转义的 needle（跳过 `\$` 转义；needle 固定 `$$`） */
function findDollarDollar(t: string, from: number): number {
  let i = Math.max(0, from);
  while (i <= t.length - 2) {
    const idx = t.indexOf('$$', i);
    if (idx < 0) return -1;
    if (idx > 0 && t[idx - 1] === '\\') {
      i = idx + 2;
      continue;
    }
    return idx;
  }
  return -1;
}

/** 区间是否与已占用区间表相交 */
function overlapsAny(ranges: ReadonlyArray<readonly [number, number]>, from: number, to: number): boolean {
  return ranges.some(([a, b]) => from < b && to > a);
}

/** 空光标/选区是否落在 [from, to) 内部（to 边界不算，保证「刚打完闭合符」立即渲染） */
function spanSelected(ranges: ReadonlyArray<readonly [number, number]>, from: number, to: number): boolean {
  return ranges.some(([a, b]) => Math.min(a, b) < to && Math.max(a, b) > from);
}

/** 行内 `$…$` 扫描（跳过 `\$` 转义、`$$` 块级、内容首尾空白），命中回调 cb */
function scanInlineMath(
  text: string,
  base: number,
  occupied: ReadonlyArray<readonly [number, number]>,
  cb: (from: number, to: number, inner: string) => void,
): void {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '$') {
      i += 2;
      continue;
    }
    if (ch === '$' && text[i + 1] === '$') {
      i += 2; // 块级数学由 Pass 2 处理；未闭合的 $$ 在行内按字面跳过
      continue;
    }
    if (ch === '$') {
      let j = i + 1;
      let found = -1;
      while (j < text.length) {
        if (text[j] === '\\' && text[j + 1] === '$') {
          j += 2;
          continue;
        }
        if (text[j] === '$') {
          found = j;
          break;
        }
        j += 1;
      }
      if (found > i) {
        const inner = text.slice(i + 1, found);
        // 内容非空且首尾非空白（避免 $5 与 $6 之类的价格误判）
        if (inner.trim() !== '' && !/^\s/.test(inner) && !/\s$/.test(inner)) {
          const from = base + i;
          const to = base + found + 1;
          if (!overlapsAny(occupied, from, to)) cb(from, to, inner);
          i = found + 1;
          continue;
        }
      }
      i += 1;
      continue;
    }
    i += 1;
  }
}

/* ================= 装饰构建 ================= */

function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const sel = state.selection.ranges.map((r) => [r.from, r.to] as const);
  const items: Array<{ from: number; to: number; deco: Decoration }> = [];

  const lines: Array<{ from: number; to: number; text: string }> = [];
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    lines.push({ from: line.from, to: line.to, text: line.text });
  }

  /** 被块级结构（代码围栏 / $$ 数学块）占用的行：行内 pass 跳过 */
  const blocked = new Set<number>();
  /** 行首装饰（标题/引用 hide、列表 marker widget）占用的区间：行内 pass 防重叠 */
  const rowOccupied = new Map<number, Array<[number, number]>>();
  const occupy = (idx: number, from: number, to: number): void => {
    const arr = rowOccupied.get(idx) ?? [];
    arr.push([from, to]);
    rowOccupied.set(idx, arr);
  };

  /* ---- Pass 1: 代码围栏 → 代码块 Widget（光标进入回显源码） ---- */
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
          items.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new CodeBlockWidget(fence[1] ?? '', body.join('\n')),
            }),
          });
        }
        for (let k = i; k <= close; k += 1) blocked.add(k);
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }

  /* ---- Pass 2: $$…$$ 块级数学（支持跨行；同行单对优先） ---- */
  i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blocked.has(i)) {
      i += 1;
      continue;
    }
    const t = line.text;
    const open = findDollarDollar(t, 0);
    if (open < 0) {
      i += 1;
      continue;
    }
    // 情形 A：同行闭合 $$x$$
    const closeSame = findDollarDollar(t, open + 2);
    if (closeSame >= 0) {
      const inner = t.slice(open + 2, closeSame);
      if (inner.trim() !== '') {
        const from = line.from + open;
        const to = line.from + closeSame + 2;
        if (!selectionInside(sel, from, to)) {
          items.push({ from, to, deco: Decoration.replace({ widget: new KatexWidget(inner, true) }) });
        }
        blocked.add(i);
        i += 1;
        continue;
      }
    } else {
      // 情形 B：跨行闭合（$$ 与 $$ 之间可有任意行）
      let j = i + 1;
      let closed = -1;
      let closeCol = -1;
      while (j < lines.length) {
        const c = findDollarDollar(lines[j]!.text, 0);
        if (c >= 0) {
          closed = j;
          closeCol = c;
          break;
        }
        j += 1;
      }
      if (closed >= 0) {
        const parts = [t.slice(open + 2)];
        for (let k = i + 1; k < closed; k += 1) parts.push(lines[k]!.text);
        parts.push(lines[closed]!.text.slice(0, closeCol));
        const inner = parts.join('\n');
        if (inner.trim() !== '') {
          const from = line.from + open;
          const to = lines[closed]!.from + closeCol + 2;
          if (!selectionInside(sel, from, to)) {
            items.push({ from, to, deco: Decoration.replace({ widget: new KatexWidget(inner, true) }) });
          }
          for (let k = i; k <= closed; k += 1) blocked.add(k);
          i = closed + 1;
          continue;
        }
      }
    }
    // 无法闭合或内容为空：不渲染，Pass 4 会把 $$ 按字面跳过
    i += 1;
  }

  /* ---- Pass 3: 标题 / 引用 / 列表 marker（行首结构） ---- */
  lines.forEach((line, idx) => {
    if (blocked.has(idx)) return;
    const head = line.text.match(/^(\s*)(#{1,6})\s+(.*)$/);
    if (head) {
      const level = head[2]!.length;
      const markerEnd = line.from + (head[1]?.length ?? 0) + level + 1;
      items.push({ from: line.from, to: markerEnd, deco: hide });
      items.push({ from: markerEnd, to: line.to, deco: Decoration.mark({ class: `cm-lp-heading cm-lp-h${level}` }) });
      occupy(idx, line.from, markerEnd);
      return;
    }
    const quote = line.text.match(/^(\s*)>\s?(.*)$/);
    if (quote) {
      const markerEnd = line.from + (quote[1]?.length ?? 0) + 1;
      items.push({ from: line.from, to: markerEnd, deco: hide });
      items.push({ from: markerEnd, to: line.to, deco: Decoration.mark({ class: 'cm-lp-quote-text' }) });
      occupy(idx, line.from, markerEnd);
      return;
    }
    // 无序列表：marker 字符 → 圆点 widget；可选任务 checkbox
    const bullet = line.text.match(/^(\s*)([-*+])(\s+)/);
    if (bullet) {
      const indent = bullet[1]!.length;
      const markerFrom = line.from + indent;
      const markerTo = markerFrom + 1;
      const depth = Math.min(3, Math.floor(indent / 2));
      if (!spanSelected(sel, markerFrom, markerTo)) {
        items.push({ from: markerFrom, to: markerTo, deco: Decoration.replace({ widget: new BulletWidget(depth) }) });
      }
      occupy(idx, markerFrom, markerTo);
      const restBase = markerTo + bullet[3]!.length;
      addCheckbox(line, idx, restBase, sel, items);
      return;
    }
    // 有序列表：`1.` / `2)` → 数字 widget；可选任务 checkbox
    const num = line.text.match(/^(\s*)(\d+)([.)])(\s+)/);
    if (num) {
      const indent = num[1]!.length;
      const markerFrom = line.from + indent;
      const markerTo = markerFrom + num[2]!.length + 1;
      if (!spanSelected(sel, markerFrom, markerTo)) {
        items.push({
          from: markerFrom,
          to: markerTo,
          deco: Decoration.replace({ widget: new NumWidget(num[2]!, num[3]!) }),
        });
      }
      occupy(idx, markerFrom, markerTo);
      const restBase = markerTo + num[4]!.length;
      addCheckbox(line, idx, restBase, sel, items);
      return;
    }
  });

  /** 任务列表 checkbox（`[ ]` / `[x]` 紧跟列表 marker 空白之后） */
  function addCheckbox(
    line: { from: number; text: string },
    idx: number,
    restBase: number,
    ranges: ReadonlyArray<readonly [number, number]>,
    out: Array<{ from: number; to: number; deco: Decoration }>,
  ): void {
    const rest = line.text.slice(restBase - line.from);
    const cb = rest.match(/^\[([ xX])\](?=\s|$)/);
    if (!cb) return;
    const cbFrom = restBase;
    const cbTo = cbFrom + 3;
    if (!spanSelected(ranges, cbFrom, cbTo)) {
      out.push({ from: cbFrom, to: cbTo, deco: Decoration.replace({ widget: new CheckboxWidget(cb[1] !== ' ') }) });
    }
    occupy(idx, cbFrom, cbTo);
  }

  /* ---- Pass 4: 行内标记（所有未 blocked 行，含标题/引用/列表行内的公式/粗斜体） ---- */
  lines.forEach((line, idx) => {
    if (blocked.has(idx)) return;
    const occupied: Array<[number, number]> = [...(rowOccupied.get(idx) ?? [])];

    // 4a: 粗体 / 斜体 / 行内代码 / 删除线 / 链接 / 图片（code span 在此被记录，保护后续数学）
    inlineRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(line.text))) {
      const base = line.from + m.index;
      const fullLen = m[0].length;
      const fullTo = base + fullLen;
      if (overlapsAny(occupied, base, fullTo)) continue;

      // 图片 ![alt](url)
      if (m[1] !== undefined && m[2] !== undefined) {
        if (!selectionInside(sel, base, fullTo)) {
          items.push({ from: base, to: fullTo, deco: Decoration.replace({ widget: new InlineImageWidget(m[2] ?? '', m[1] ?? '') }) });
        }
        occupied.push([base, fullTo]);
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
        items.push({
          from: base + 1,
          to: base + 1 + textLen,
          deco: Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': m[12]! } }),
        });
        items.push({ from: base + 1 + textLen, to: base + 1 + textLen + urlLen + 2, deco: hide });
      }
      occupied.push([base, fullTo]);
    }

    // 4b: 行内 $…$ 数学（跳过 code span 与行首装饰区间）
    scanInlineMath(line.text, line.from, occupied, (from, to, inner) => {
      if (!selectionInside(sel, from, to)) {
        items.push({ from, to, deco: Decoration.replace({ widget: new KatexWidget(inner, false) }) });
      }
      occupied.push([from, to]);
    });
  });

  /* ---- 排序写入（保证非重叠） ---- */
  items.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const item of items) {
    builder.add(item.from, item.to, item.deco);
  }
  return builder.finish();
}

/* ---- 代码块 / 行内图片 Widget（本地实现，点击回显走动态 posAtDOM） ---- */

class CodeBlockWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
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
    makeClickToPos(wrap, 0);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class InlineImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: InlineImageWidget): boolean {
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
    makeClickToPos(fig, 0);
    return fig;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/* ================= StateField ================= */

/** 安全构建装饰（异常兜底为空集，绝不冻结编辑器） */
function safeBuild(state: EditorState): DecorationSet {
  try {
    return buildDecorations(state);
  } catch {
    return Decoration.none;
  }
}

/**
 * WYSIWYG 装饰字段（StateField 提供——跨行 replace 的硬性要求，见文件头注释）
 *
 * 更新策略（全量重建）：
 * docChanged / selection → 全量重建（与生产 cm-live-preview 同策略，实测流畅；
 * KaTeX 渲染只在 widget eq 变化时发生，重建本身是轻量对象分配）。
 */
const wysiwygField = StateField.define<DecorationSet>({
  create: (state) => safeBuild(state),
  update: (deco, tr) => {
    if (tr.docChanged || tr.selection) return safeBuild(tr.state);
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 获取 WYSIWYG 扩展（与 livePreview() 互斥使用，二者都提供 decorations） */
export function wysiwygPreview(): Extension {
  return wysiwygField;
}
