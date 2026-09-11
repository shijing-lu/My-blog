/**
 * Callout：`> [!type]` 引用块 → <Callout>
 *
 * 从 mdx-plugins.ts 拆出（P1-9 大文件拆分）：原文近 1600 行，四大语法块与公共插件
 * 挤在一个文件里，改一处要在千行上下文里定位。本模块只保留该语法自身的
 * 常量 / 拆分函数 / remark 插件；公共节点助手见 ./nodes。
 */
import type { Node, Root, RootContent } from 'mdast';
import { jsxAttr, jsxFlow, patched, type MdxDirectiveNode, type MdxJsxAttr } from './nodes';

/** 便捷别名：容器插件里统一按 DirectiveNode 书写 */
type DirectiveNode = MdxDirectiveNode;

/* ============================================================================
 * Obsidian 风格 Callout：`> [!type] 标题` / `> [!type]-` 折叠
 * ==========================================================================*/

/** 支持的 callout 类型（对齐 Obsidian 全量内置类型） */
export const CALLOUT_TYPES = [
  'note', 'info', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

/**
 * Obsidian 内置类型的**别名 → 规范名**映射。
 * 用户写 `> [!hint]` 或 `> [!caution]` 等别名时归一到规范类型，避免样式缺失。
 */
const CALLOUT_ALIASES: Record<string, CalloutType> = {
  // note 系
  note: 'note',
  // info 系
  info: 'info', todo: 'info', abstract: 'info', summary: 'info', tldr: 'info',
  // tip 系
  tip: 'tip', hint: 'tip', important: 'tip',
  // success 系
  success: 'success', check: 'success', done: 'success',
  // question 系
  question: 'question', help: 'question', faq: 'question',
  // warning 系
  warning: 'warning', caution: 'warning', attention: 'warning',
  // failure 系
  failure: 'failure', fail: 'failure', missing: 'failure',
  // danger 系
  danger: 'danger', error: 'danger',
  // bug 系
  bug: 'bug',
  // example 系
  example: 'example',
  // quote 系
  quote: 'quote', cite: 'quote',
};

/**
 * Callout 标题行匹配（blockquote 首段首行的文本）：
 *   [!type]            → 默认标题，不可折叠
 *   [!type]-           → 默认标题，**默认折叠**
 *   [!type]+           → 默认标题，默认展开（显式）
 *   [!type] 自定义标题  → 空格分隔写法
 *   [!type]【自定义标题】→ 紧贴写法（中括号/书名号等任意字符都吃下）
 *
 * 类型名与折叠符号之间不允许有空格（Obsidian 规范），折叠符号后允许空格。
 * ⚠️ 注意：连续引用行会被 mdast 合并为**同一个 text 节点**（值含 `\n`），
 * 因此匹配发生在「首行」而非「整个节点」，见 splitCalloutHead。
 */
const CALLOUT_HEAD_RE = /^\s*\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;

/**
 * 拆出 blockquote 首行：返回 { headText, restChildren }
 *
 * ⚠️ 两个必须同时处理的 mdast 事实：
 * 1. 连续引用行会被合并为**同一个 text 节点**（值含 `\n`）→ 按首个换行切分
 * 2. 标题行含 Markdown 富文本时（如 `**【例 5.1】** 题干`），该行会被拆成
 *    多个节点（text / strong / emphasis / inlineCode …）→ 需按「行内节点」聚合，
 *    直到遇到含 `\n` 的节点为止，才把剩余部分归入正文。
 *
 * headText 为标题行的**纯文本**（富文本节点的文字已并入），用于正则匹配与标题取值。
 */
function splitCalloutHead(paragraph: Node): { headText: string; headNodes: Node[]; restChildren: Node[] } | null {
  const children = ((paragraph as { children?: Node[] }).children ?? []).slice();
  if (children.length === 0) return null;
  const first = children[0];
  if (!first || first.type !== 'text') return null;

  const headNodes: Node[] = [];
  let restChildren: Node[] = [];
  let headText = '';
  let done = false;

  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]!;
    if (done) {
      restChildren.push(node);
      continue;
    }
    if (node.type === 'text') {
      const raw = String((node as { value?: unknown }).value ?? '');
      const nl = raw.indexOf('\n');
      if (nl === -1) {
        headNodes.push(node);
        headText += raw;
      } else {
        // 该节点跨行：切分出标题行部分，余下作为正文续行
        const headPart = raw.slice(0, nl);
        const tailPart = raw.slice(nl + 1);
        if (headPart !== '') {
          headNodes.push(patched(node, { value: headPart }));
          headText += headPart;
        }
        if (tailPart.trim() !== '') {
          restChildren.push(patched(node, { value: tailPart }));
        }
        done = true;
      }
    } else {
      // 行内富文本节点（strong/emphasis/link/inlineMath…）：属于标题行，结构完整保留
      headNodes.push(node);
      headText += rawTextOf(node);
    }
  }
  return { headText, headNodes, restChildren };
}

/**
 * 提取行内节点的纯文本（用于标题行正则匹配与标题取值）。
 *
 * ⚠️ 此处在 **remark 阶段**运行，`$…$` 还是普通的 text 节点（尚未经 rehype-katex 渲染），
 * 因此公式会以原始 `$…$` 形式并入标题文本——这正是我们想要的：
 * 标题是纯文本，保留 `$\lambda$` 写法比渲染成图片更可读（且不破坏正则匹配）。
 */
function rawTextOf(node: Node): string {
  if (node.type === 'text') return String((node as { value?: unknown }).value ?? '');
  // 行内公式（remark-math 的 inlineMath 节点）→ 还原为 $…$ 原文
  if (node.type === 'inlineMath') {
    return `$${String((node as { value?: unknown }).value ?? '')}$`;
  }
  const children = (node as { children?: Node[] }).children;
  if (Array.isArray(children)) return children.map(rawTextOf).join('');
  return '';
}

/**
 * 从标题行节点中剥掉 `[!type]-` 前缀，返回剩余的富文本节点（结构完整保留）。
 *
 * 前缀（含 `[!type]` 与折叠符）总是出现在首个文本节点里，因此按前缀长度对其切片。
 * ⚠️ 前缀长度 = `[!` + 类型名 + `]` + 折叠符，必须精确计算——
 * 不能用正则反推整个匹配串（`(.*)` 会吞掉标题正文）。
 *
 * `type` 为归一的规范类型名（长度可能与用户原文不同），因此用原文类型名长度计算。
 */
function stripHeadPrefix(headNodes: Node[], rawTypeName: string, marker: string): Node[] {
  const prefixLen = 2 + rawTypeName.length + 1 + marker.length; // `[!` + name + `]` + `-`/`+`
  const out: Node[] = [];
  let consumed = 0;
  let dropped = false;
  for (const node of headNodes) {
    if (dropped) {
      out.push(node);
      continue;
    }
    if (node.type !== 'text') {
      out.push(node);
      continue;
    }
    const raw = String((node as { value?: unknown }).value ?? '');
    const remaining = prefixLen - consumed;
    if (remaining <= 0) {
      out.push(node);
      continue;
    }
    if (raw.length <= remaining) {
      consumed += raw.length;
      dropped = true;
      continue;
    }
    // 前缀后可能紧跟空格（`[!note] 标题`），一并去掉前导空白
    const rawTail = raw.slice(remaining);
    const tail = rawTail.replace(/^[ \t]+/, '');
    if (tail !== '') {
      out.push(patched(node, { value: tail }));
    }
    dropped = true;
  }
  return out;
}

/**
 * 剥离行内 Markdown 标记，保留可读文字。
 * 覆盖：粗体、斜体、行内代码、删除线、链接（保留链接文字）、图片（保留 alt）。
 *
 * ⚠️ 必须跳过 `$…$` / `$$…$$` 公式区域——LaTeX 里的 `_`、`*` 会被误判为
 * 斜体/粗体标记（如 `A^{-1}` 的 `_`、`x^*` 的 `*`）。做法是先把公式抽成占位符，
 * 处理完其余文本后再回填。
 */
function stripInlineMarkdown(s: string): string {
  const formulas: string[] = [];
  // 先保护块级公式，再保护行内公式（避免 $ 成对错配）
  const guarded = s
    .replace(/\$\$([\s\S]+?)\$\$/g, (m) => `\u0000${formulas.push(m) - 1}\u0000`)
    .replace(/\$([^$\n]+?)\$/g, (m) => `\u0000${formulas.push(m) - 1}\u0000`);

  const stripped = guarded
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // 图片 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // 链接 → 文字
    .replace(/(\*\*|__)(.*?)\1/g, '$2')          // 粗体
    .replace(/(\*|_)(.*?)\1/g, '$2')             // 斜体
    .replace(/~~(.*?)~~/g, '$1')                 // 删除线
    .replace(/`([^`]*)`/g, '$1')                 // 行内代码
    .trim();

  // 回填公式原文
  return stripped.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => formulas[Number(i)] ?? '');
}

/**
 * remark 插件：把 Obsidian 风格 `> [!type]` 引用块转换为 `<Callout>` JSX 节点。
 *
 * 语法（blockquote 首段首行）：
 *   > [!note] 自定义标题      默认展开，带标题
 *   > [!note]-               默认折叠（仅标题行可见）
 *   > [!note]+               默认展开（显式声明可折叠）
 *
 * 折叠语义（本项目定版）：折叠时**仅标题行可见**，其余内容整体隐藏。
 * 因此「题干 + 解析」场景需把题干写进标题行（见 README/示例）。
 *
 * 非 callout 的普通引用块原样保留，不受影响。
 */
export function remarkCallout() {
  return (tree: Root) => {
    const walk = (children: Node[]): void => {
      for (let i = 0; i < children.length; i += 1) {
        const node = children[i] as DirectiveNode;
        if (node.type === 'blockquote') {
          const inner = (node.children ?? []) as Node[];
          const split = inner[0] ? splitCalloutHead(inner[0]) : null;
            const m = split ? CALLOUT_HEAD_RE.exec(split.headText) : null;
          if (m && split) {
            const rawType = (m[1] ?? '').toLowerCase();
            const type: CalloutType = CALLOUT_ALIASES[rawType] ?? 'note';
            const marker = m[2] ?? '';
            // 标题行剥掉 `[!type]-` 前缀后的富文本节点（保留加粗/公式/行内代码结构），
            // 作为 Callout 的首个「标记段落」传入，组件渲染时抽进 <summary>。
            const richNodes = stripHeadPrefix(split.headNodes, m[1] ?? '', marker);
            const plainTitle = stripInlineMarkdown(m[3] ?? '');

            const body: Node[] = [];
            if (split.restChildren.length > 0) {
              body.push(patched(inner[0]!, { children: split.restChildren }));
            }
            body.push(...inner.slice(1));

            // ⚠️ 必须先把 body 递归处理完再 push 进 jsxChildren：
            // walk 是「就地替换数组元素」（children[i] = ...），而 jsxChildren.push(...body)
            // 是展开 push——push 之后替换 body[i] 不会反映到 jsxChildren，嵌套 Callout 会丢失。
            walk(body);

            const attrs: MdxJsxAttr[] = [jsxAttr('type', type)];
            // 无富文本节点时才用纯文本 title（富文本优先，见下方标记段落）
            if (richNodes.length === 0 && plainTitle) {
              attrs.push(jsxAttr('title', plainTitle));
            }
            // `-` 默认折叠；`+` 或空 默认展开。仅 `-`/`+` 才渲染折叠交互
            if (marker === '-' || marker === '+') {
              attrs.push(jsxAttr('foldable', 'true'));
              if (marker === '-') attrs.push(jsxAttr('collapsed', 'true'));
            }

            const jsxChildren: Node[] = [];
            if (richNodes.length > 0) {
              // 标题行作为首个 children，打上 data-callout-head 标记供组件识别与抽取
              jsxChildren.push(jsxFlow('p', [jsxAttr('data-callout-head', 'true')], richNodes));
            }
            jsxChildren.push(...body);

            children[i] = jsxFlow('Callout', attrs, jsxChildren) as unknown as RootContent;
            continue;
          }
          // 非 callout 的引用块：继续深入其子级（内部可能含 callout）
          walk(inner);
          continue;
        }
        if (Array.isArray(node.children)) walk(node.children);
      }
    };
    walk(tree.children);
  };
}

