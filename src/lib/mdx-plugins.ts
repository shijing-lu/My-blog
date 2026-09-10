/**
 * MDX 渲染管线：统一 remark / rehype 插件 + 指令 → JSX + TOC 采集
 *
 * <!-- 区域划分 -->
 * - Imports: remark / rehype / mdast·hast 类型
 * - Directive: remarkDirectiveToJsx（:::指令 → Admonition JSX）
 * - Toc: rehypeTocCollector（h2/h3 → TOC）
 * - Plugins: 服务端与浏览器预览共用的插件数组
 */
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrismPlus from 'rehype-prism-plus';
import rehypeKatex from 'rehype-katex';
import rehypeTableMath from './rehype-table-math';
import { toHtml } from 'hast-util-to-html';
import type { Processor } from 'unified';
import type { Root, RootContent, Node, Paragraph } from 'mdast';
import type { Element, ElementContent, Root as HastRoot } from 'hast';

/** 支持的 admonition 类型 */
export const ADMONITION_TYPES = ['note', 'tip', 'warning', 'danger', 'info'] as const;
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];

/** 目录项 */
export interface TocItem {
  /** 标题 id（由 rehype-slug 生成） */
  id: string;
  /** 标题文本（KaTeX 节点取 LaTeX 源码，纯文本展示用） */
  text: string;
  /** 级别（2=H2，3=H3，4=H4） */
  level: 2 | 3 | 4;
  /** 标题内层 HTML（含 KaTeX 渲染标记，供目录富文本渲染；纯文本场景可忽略） */
  html?: string;
}

/** 块级锚点条目（思维导图节点引用段落用） */
export interface BlockAnchorItem {
  /** 块标签（p/li/pre/blockquote/h2 等） */
  type: string;
  /** 文本摘要（前 60 字，用于失效兜底定位） */
  text: string;
}

/** 块级锚点映射：para-N → 块信息 */
export type BlockAnchorMap = Record<string, BlockAnchorItem>;

/** 需要加锚点的块级标签（思维导图「片段引用」的定位粒度） */
const BLOCK_ANCHOR_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'pre', 'blockquote', 'table', 'ul', 'ol', 'figure',
]);

/**
 * rehype 插件：给文章块级元素加稳定锚点 id（para-1, para-2, …）。
 * 必须与渲染 HTML 用同一管线（本插件加入 rehypePlugins 由 evaluate 执行），
 * 服务端再从渲染结果收集 blockMap（见 mdx.ts collectBlockMapFromHtml）。
 */
export function rehypeBlockAnchors() {
  return (tree: HastRoot) => {
    let n = 0;
    const walk = (node: Element | HastRoot): void => {
      if (node.type === 'element') {
        if (BLOCK_ANCHOR_TAGS.has(node.tagName)) {
          n += 1;
          // 保留已有 id（rehypeSlug 生成的标题锚点），仅给无 id 的块生成 para-N
          // （否则覆写标题 id 会导致右侧目录的 #slug 锚点跳转失效）
          if (!node.properties?.id) {
            node.properties = { ...(node.properties ?? {}), id: `para-${n}` };
          }
        }
        if (Array.isArray(node.children)) {
          node.children.forEach((child) => walk(child as Element));
        }
      } else if (Array.isArray(node.children)) {
        node.children.forEach((child) => walk(child as Element));
      }
    };
    walk(tree);
  };
}

/** 便捷类型：含可选 name/children/attributes 的节点 */
type DirectiveNode = Node & {
  name?: string;
  children?: Node[];
  /** remark-directive 解析出的属性（`:::collapse{accordion}` → `{ accordion: '' }`） */
  attributes?: Record<string, string>;
};

/** 递归转换某子级数组（含嵌套） */
function transformChildren(children: Node[]): void {
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i] as DirectiveNode;
    const isDirective =
      node.type === 'containerDirective' ||
      node.type === 'leafDirective' ||
      node.type === 'textDirective';
    if (isDirective && node.name && (ADMONITION_TYPES as readonly string[]).includes(node.name)) {
      const isText = node.type === 'textDirective';
      const newNode = {
        type: isText ? 'mdxJsxTextElement' : 'mdxJsxFlowElement',
        name: 'Admonition',
        attributes: [{ type: 'mdxJsxAttribute', name: 'type', value: node.name }],
        children: node.children ?? [],
      } as unknown as RootContent;
      children[i] = newNode;
      transformChildren(node.children ?? []);
      continue;
    }
    if (Array.isArray(node.children)) {
      transformChildren(node.children);
    }
  }
}

/**
 * remark 插件：把 `:::note` 容器指令转换为 `<Admonition type="note">` JSX 节点。
 * - `containerDirective` / `leafDirective` → `mdxJsxFlowElement`
 * - `textDirective` → `mdxJsxTextElement`
 * 仅识别 ADMONITION_TYPES，其余指令原样保留。
 */
export function remarkDirectiveToJsx() {
  return (tree: Root) => {
    transformChildren(tree.children);
  };
}

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
          headNodes.push({ ...(node as unknown as Record<string, unknown>), value: headPart } as unknown as Node);
          headText += headPart;
        }
        if (tailPart.trim() !== '') {
          restChildren.push({ ...(node as unknown as Record<string, unknown>), value: tailPart } as unknown as Node);
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
      out.push({ ...(node as unknown as Record<string, unknown>), value: tail } as unknown as Node);
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
              body.push({ ...(inner[0] as unknown as Record<string, unknown>), children: split.restChildren } as unknown as Node);
            }
            body.push(...inner.slice(1));

            // ⚠️ 必须先把 body 递归处理完再 push 进 jsxChildren：
            // walk 是「就地替换数组元素」（children[i] = ...），而 jsxChildren.push(...body)
            // 是展开 push——push 之后替换 body[i] 不会反映到 jsxChildren，嵌套 Callout 会丢失。
            walk(body);

            const attrs: unknown[] = [
              { type: 'mdxJsxAttribute', name: 'type', value: type },
            ];
            // 无富文本节点时才用纯文本 title（富文本优先，见下方标记段落）
            if (richNodes.length === 0 && plainTitle) {
              attrs.push({ type: 'mdxJsxAttribute', name: 'title', value: plainTitle });
            }
            // `-` 默认折叠；`+` 或空 默认展开。仅 `-`/`+` 才渲染折叠交互
            if (marker === '-' || marker === '+') {
              attrs.push({ type: 'mdxJsxAttribute', name: 'foldable', value: 'true' });
              if (marker === '-') attrs.push({ type: 'mdxJsxAttribute', name: 'collapsed', value: 'true' });
            }

            const jsxChildren: Node[] = [];
            if (richNodes.length > 0) {
              // 标题行作为首个 children，打上 data-callout-head 标记供组件识别与抽取
              jsxChildren.push({
                type: 'mdxJsxFlowElement',
                name: 'p',
                attributes: [
                  {
                    type: 'mdxJsxAttribute',
                    name: 'data-callout-head',
                    value: 'true',
                  },
                ],
                children: richNodes,
              } as unknown as Node);
            }
            jsxChildren.push(...body);

            children[i] = {
              type: 'mdxJsxFlowElement',
              name: 'Callout',
              attributes: attrs,
              children: jsxChildren,
            } as unknown as RootContent;
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

/* ============================================================================
 * 折叠面板：`:::collapse` 容器 + 无序列表 → <Collapse>
 *
 * ## 语法（对齐 VuePress Plume 主题的 collapse 容器）
 *
 *   :::collapse [accordion] [expand]
 *   - 面板标题
 *
 *     面板正文（完整块级 Markdown）
 *
 *   - :+ 默认展开的面板标题
 *
 *     正文……
 *   :::
 *
 * ## 规则
 *
 * - 容器内**有且仅有一个顶层无序列表**；每个列表项 = 一个面板；
 * - 列表项内：**首行到首个空行为标题**，首个空行之后为正文（完整块级 Markdown）；
 * - `:+` / `:-` 前缀标记该项初始「展开 / 折叠」，写在标题之前（`- :+ 标题`）；
 * - `accordion` 整组互斥（用 HTML `<details name>` 原生实现，零 JS）；
 * - `expand` 整组默认展开；此时 `:-` 可把单项压回折叠；
 * - 默认（无参数）：全部折叠，仅 `:+` 标记项展开。
 *
 * ## 参数来源
 *
 * remark-directive 只认花括号属性，源码层的 `normalizeCollapseParams`
 * （src/lib/mdx.ts）已把空格写法 `:::collapse accordion` 改写为
 * `:::collapse{accordion}`，因此这里直接读 `attributes`。
 *
 * ## 与列表项解析的配合
 *
 * 列表项的 `spread`（松散列表）会让「标题行」与「正文」被拆成多个段落。
 * 这里不依赖 spread，而是**按 children 顺序**取：第一个 paragraph 的首行
 * 做标题，其残余内容 + 后续所有块做正文 —— 与 Plume 语义一致且更健壮。
 * ==========================================================================*/

/** `:::collapse` 已识别的参数（由源码层保证只出现白名单词） */
const COLLAPSE_PARAM_NAMES_LOCAL = new Set(['accordion', 'expand']);

/** 标题行前的初始状态标记：源码层已把 `:+` / `:-` 编码为哨兵 + 符号 */
const COLLAPSE_MARK_SENT = '\uE002';

/**
 * 从标题节点数组中剥离并返回初始状态标记（`+` 展开 / `-` 折叠）。
 *
 * 源码层 `encodeCollapseMarkers` 已把 `:+` 变为 `<哨兵>+`，因此这里
 * 在**首个文本节点**里找 `<哨兵><符号>`。找不到返回空串（跟随组默认值）。
 *
 * ⚠️ 不能在源码层保留裸 `:` —— remark-directive 会把它吃成 textDirective，
 * 既匹配不到文本，还会渲染出空 `<div>`。
 */
function takeCollapseMarker(nodes: Node[]): string {
  for (const node of nodes) {
    const n = node as Node & { value?: string };
    if (n.type !== 'text' || typeof n.value !== 'string') continue;
    const idx = n.value.indexOf(COLLAPSE_MARK_SENT);
    if (idx === -1) {
      // 标记必定在最前面的文本节点；首个文本节点没有就说明该项无标记
      return '';
    }
    const sign = n.value.charAt(idx + COLLAPSE_MARK_SENT.length);
    const marker = sign === '+' || sign === '-' ? sign : '';
    // 一并吃掉哨兵、符号与紧随其后的空白
    const before = n.value.slice(0, idx);
    const after = n.value.slice(idx + COLLAPSE_MARK_SENT.length + 1).replace(/^[ \t]+/, '');
    n.value = before + after;
    return marker;
  }
  return '';
}

/**
 * 从列表项中拆出「标题节点」与「正文节点」。
 *
 * 取法：
 * 1. 首个 paragraph 的第一行（遇到 `\n` 为止）为标题原文；
 * 2. 该 paragraph 剩余的兄弟节点（`\n` 之后的富文本）留在正文首段；
 * 3. 其余 children 全部归正文。
 *
 * @returns `{ headNodes, marker, bodyNodes }`；无标题（首子不是段落）时 headNodes 为空
 */
function splitCollapseItem(item: Node): { headNodes: Node[]; marker: string; bodyNodes: Node[] } {
  const children = ((item as DirectiveNode).children ?? []) as Node[];
  const first = children[0];
  if (!first || first.type !== 'paragraph') {
    return { headNodes: [], marker: '', bodyNodes: children };
  }

  const para = first as Paragraph;
  const paraChildren = (para.children ?? []) as Node[];
  const headNodes: Node[] = [];
  const restNodes: Node[] = [];
  let sawBreak = false;

  for (const child of paraChildren) {
    const c = child as Node & { value?: string };
    if (!sawBreak && c.type === 'text' && typeof c.value === 'string' && c.value.includes('\n')) {
      // 首个含换行的文本节点：换行前为标题，换行后归正文
      const [headPart, ...restParts] = c.value.split('\n');
      const restText = restParts.join('\n');
      if (headPart !== '') headNodes.push({ ...c, value: headPart } as unknown as Node);
      if (restText !== '') restNodes.push({ ...c, value: restText } as unknown as Node);
      sawBreak = true;
      continue;
    }
    if (!sawBreak) headNodes.push(child);
    else restNodes.push(child);
  }

  // 首段没有换行 → 整段都是标题（项内无正文）
  const bodyNodes: Node[] = [];
  if (restNodes.length > 0) {
    bodyNodes.push({ ...first, children: restNodes } as unknown as Node);
  }
  bodyNodes.push(...children.slice(1));

  // 剥离并记录 `:+` / `:-` 标记（哨兵形态，只看标题节点）
  const marker = takeCollapseMarker(headNodes);

  return { headNodes, marker, bodyNodes };
}

/**
 * remark 插件：把 `:::collapse` 容器转换为 `<Collapse>` JSX 节点。
 *
 * 每个面板产出为一个 `<CollapsePanel>` 子节点；标题（含富文本）作为
 * `data-collapse-head` 标记段落置于首位，供组件抽进 `<summary>`。
 *
 * 非法形态（容器内没有无序列表 / 列表项为空）→ **原样保留**容器内容，
 * 不静默吞掉用户内容。
 */
export function remarkCollapse() {
  return (tree: Root) => {
    const walk = (children: Node[]): void => {
      for (let i = 0; i < children.length; i += 1) {
        const node = children[i] as DirectiveNode;
        if (node.type !== 'containerDirective' || node.name !== 'collapse') {
          if (Array.isArray(node.children)) walk(node.children);
          continue;
        }

        // 参数：源码层已把空格写法归一为花括号属性
        const attrs = (node.attributes ?? {}) as Record<string, string>;
        const accordion = Object.keys(attrs).some(
          (k) => COLLAPSE_PARAM_NAMES_LOCAL.has(k.toLowerCase()) && k.toLowerCase() === 'accordion',
        );
        const expandAll = Object.keys(attrs).some((k) => k.toLowerCase() === 'expand');

        // 容器内必须是「恰好一个顶层无序列表」（允许列表前后有空白段落）
        const inner = (node.children ?? []) as Node[];
        const lists = inner.filter((c) => c.type === 'list');
        const isOrdered = lists.some((l) => (l as unknown as { ordered?: boolean }).ordered === true);
        if (lists.length !== 1 || isOrdered) {
          walk(inner);
          continue;
        }

        const list = lists[0] as DirectiveNode;
        const items = ((list.children ?? []) as Node[]).filter((c) => c.type === 'listItem');
        if (items.length === 0) {
          walk(inner);
          continue;
        }

        const panels: Node[] = items.map((item) => {
          const { headNodes, marker, bodyNodes } = splitCollapseItem(item);
          // 展开态优先级：单项 `:-` > 单项 `:+` > 整组 expand > 默认折叠
          let open = expandAll;
          if (marker === '+') open = true;
          if (marker === '-') open = false;

          const panelChildren: Node[] = [];
          if (headNodes.length > 0) {
            panelChildren.push({
              type: 'mdxJsxFlowElement',
              name: 'p',
              attributes: [
                { type: 'mdxJsxAttribute', name: 'data-collapse-head', value: 'true' },
              ],
              children: headNodes,
            } as unknown as Node);
          }
          // ⚠️ 必须先递归处理正文再 push（walk 是就地替换，见 remarkCallout 同款说明）
          walk(bodyNodes);
          panelChildren.push(...bodyNodes);

          return {
            type: 'mdxJsxFlowElement',
            name: 'CollapsePanel',
            attributes: [
              { type: 'mdxJsxAttribute', name: 'open', value: open ? 'true' : 'false' },
            ],
            children: panelChildren,
          } as unknown as Node;
        });

        children[i] = {
          type: 'mdxJsxFlowElement',
          name: 'Collapse',
          attributes: accordion
            ? [{ type: 'mdxJsxAttribute', name: 'accordion', value: 'true' }]
            : [],
          children: panels,
        } as unknown as RootContent;
      }
    };
    walk(tree.children);
  };
}

/* ============================================================================
 * 选项卡组：`:::tabs#id` + `@tab` 分区 → <Tabs>（对齐 VuePress Plume 主题）
 *
 * ## 源语法
 *
 *   :::tabs#package-manager
 *
 *   @tab npm
 *
 *   使用 npm 安装。
 *
 *   @tab:active **pnpm**#pnpm
 *
 *   使用 pnpm 安装。
 *
 *   :::
 *
 * - `#package-manager` 是**稳定标识值**：同页多个选项卡组只要标识相同，
 *   选中状态即互相同步（不改变标签的可见标题）；
 * - `@tab:active` 指定该项初始激活（同组多个只取第一个）；
 * - `@tab` 后的标签支持行内 Markdown（`**加粗**` / `` `代码` `` 等）；
 * - 标签尾部的 `#锚点` 是该项的稳定 ID（用于跨组联动对齐），从可见标题中剥离。
 *
 * ## 解析前置
 *
 * 源语法含三重 remark-directive 冲突（`#` 容器名、`@tab` 非标准、`:` 被吃成
 * textDirective），且 remark-directive **不支持嵌套容器**。因此源码层的
 * `normalizeTabs`（src/lib/mdx.ts）已把语法改写为「容器 + 一个无序列表」：
 * 每个 `@tab` 变成列表项 `- <哨兵>active<分隔>标签`，正文缩进为该项续行。
 * 本插件因此只需处理与 `remarkCollapse` 同构的形态。
 * ==========================================================================*/

/** 选项卡组标记哨兵（与 mdx.ts 的 TABS_MARK_SENTINEL 对应） */
const TABS_MARK_SENT = '\uE003';
/** 选项卡组标签行的字段分隔符（与 mdx.ts 的 TABS_FIELD_SEP 对应） */
const TABS_FIELD_SEP_LOCAL = '\uE004';

/**
 * 从选项卡列表项中拆出「标签节点」「激活态」「锚点」与「正文节点」。
 *
 * 源码层已把 `@tab[:active] 标签[#锚点]` 编码为列表项首行
 * `<哨兵>active<分隔>标签[#锚点]`，因此这里在首个文本节点里解出元信息。
 */
function splitTabsItem(item: Node): {
  labelNodes: Node[];
  active: boolean;
  anchor: string;
  bodyNodes: Node[];
} {
  const children = ((item as DirectiveNode).children ?? []) as Node[];
  const first = children[0];
  if (!first || first.type !== 'paragraph') {
    return { labelNodes: [], active: false, anchor: '', bodyNodes: children };
  }

  const paraChildren = ((first as Paragraph).children ?? []) as Node[];
  const labelNodes: Node[] = [];
  let active = false;
  let anchor = '';

  // 首个文本节点形如 `<S>active<分隔>锚点<分隔>标签原文(起始段)`
  // ⚠️ 标签原文可能含行内 Markdown，被 micromark 拆到后续节点（甚至 strong/em 内部）；
  //    因此这里**只吃掉前缀**（哨兵 + active 标记 + 锚点 + 紧随的分隔符），
  //    余下文本与所有后续兄弟节点原样保留为标签内容。
  let consumed = false;
  for (const child of paraChildren) {
    const c = child as Node & { value?: string };
    if (!consumed && c.type === 'text' && typeof c.value === 'string') {
      const idx = c.value.indexOf(TABS_MARK_SENT);
      if (idx !== -1) {
        const sep1 = c.value.indexOf(TABS_FIELD_SEP_LOCAL, idx);
        if (sep1 !== -1) {
          const flag = c.value.slice(idx + TABS_MARK_SENT.length, sep1);
          active = flag === 'active';
          const sep2 = c.value.indexOf(TABS_FIELD_SEP_LOCAL, sep1 + TABS_FIELD_SEP_LOCAL.length);
          if (sep2 !== -1) {
            anchor = c.value.slice(sep1 + TABS_FIELD_SEP_LOCAL.length, sep2);
            const labelHead = c.value.slice(sep2 + TABS_FIELD_SEP_LOCAL.length);
            if (labelHead !== '') labelNodes.push({ ...c, value: labelHead } as unknown as Node);
          } else {
            // 异常形态：只有一层分隔 → 分隔符后全当标签
            const labelHead = c.value.slice(sep1 + TABS_FIELD_SEP_LOCAL.length);
            if (labelHead !== '') labelNodes.push({ ...c, value: labelHead } as unknown as Node);
          }
          consumed = true;
          continue;
        }
      }
      // 首个文本节点没有哨兵 → 非本语法产出，原样保留
      consumed = true;
    }
    labelNodes.push(child);
  }

  const bodyNodes = children.slice(1);
  return { labelNodes, active, anchor, bodyNodes };
}

/**
 * remark 插件：把 `:::tabs` 容器转换为 `<Tabs>` JSX 节点。
 *
 * 每个分区产出为一个 `<Tab>` 子节点；标签（含富文本）作为
 * `data-tab-label` 标记段落置于首位，供组件抽进选项卡按钮。
 *
 * 非法形态（容器内没有无序列表 / 分区为空）→ **原样保留**，不吞用户内容。
 */
export function remarkTabs() {
  return (tree: Root) => {
    const walk = (children: Node[]): void => {
      for (let i = 0; i < children.length; i += 1) {
        const node = children[i] as DirectiveNode;
        if (node.type !== 'containerDirective' || node.name !== 'tabs') {
          if (Array.isArray(node.children)) walk(node.children);
          continue;
        }

        const attrs = (node.attributes ?? {}) as Record<string, string>;
        // 稳定标识值来自源码层改写出的 `{#id}` 简写
        // （remark-directive 不支持 `key="value"` 属性语法，详见 normalizeTabs 注释）
        const stableId = attrs.id ?? '';

        const inner = (node.children ?? []) as Node[];
        const lists = inner.filter((c) => c.type === 'list');
        const isOrdered = lists.some((l) => (l as unknown as { ordered?: boolean }).ordered === true);
        if (lists.length !== 1 || isOrdered) {
          walk(inner);
          continue;
        }

        const list = lists[0] as DirectiveNode;
        const items = ((list.children ?? []) as Node[]).filter((c) => c.type === 'listItem');
        if (items.length < 2) {
          // 少于 2 个分区：降级为普通 Markdown（源码层已判过一次，双保险）
          walk(inner);
          continue;
        }

        let activeAssigned = false;
        const tabs: Node[] = items.map((item, idx) => {
          const { labelNodes, active, anchor, bodyNodes } = splitTabsItem(item);
          // 初始激活：同组只认第一个 `:active`，其余回落到索引 0
          const isActive = active && !activeAssigned;
          if (isActive) activeAssigned = true;

          const tabChildren: Node[] = [];
          if (labelNodes.length > 0) {
            tabChildren.push({
              type: 'mdxJsxFlowElement',
              name: 'p',
              attributes: [{ type: 'mdxJsxAttribute', name: 'data-tab-label', value: 'true' }],
              children: labelNodes,
            } as unknown as Node);
          }
          // ⚠️ 必须先递归处理正文再 push（walk 就地替换，见 remarkCallout 说明）
          walk(bodyNodes);
          tabChildren.push(...bodyNodes);

          return {
            type: 'mdxJsxFlowElement',
            name: 'Tab',
            attributes: [
              { type: 'mdxJsxAttribute', name: 'active', value: isActive ? 'true' : 'false' },
              ...(anchor ? [{ type: 'mdxJsxAttribute', name: 'anchor', value: anchor }] : []),
            ],
            children: tabChildren,
          } as unknown as Node;
        });

        // 二次兜底：确保恰好有一项 active
        const anyActive = tabs.some((t) => {
          const a = (t as unknown as { attributes?: { name: string; value: string }[] }).attributes;
          return a?.some((x) => x.name === 'active' && x.value === 'true');
        });
        if (!anyActive && tabs.length > 0) {
          const a = (tabs[0] as unknown as { attributes: { name: string; value: string }[] })
            .attributes;
          const attr = a.find((x) => x.name === 'active');
          if (attr) attr.value = 'true';
        }

        children[i] = {
          type: 'mdxJsxFlowElement',
          name: 'Tabs',
          attributes: stableId ? [{ type: 'mdxJsxAttribute', name: 'stableId', value: stableId }] : [],
          children: tabs,
        } as unknown as RootContent;
      }
    };
    walk(tree.children);
  };
}

/* ============================================================================
 * 荧光高亮标记：`==文本==` → <mark class="mark mark-*">（M3E 风格语法）
 *
 * 语法：
 *   ==文本==                默认（primary，跟随文章主色调）
 *   ==文本=={.tip}          后缀语义色修饰符（可省 `.`）
 *   ==tip:文本==            前缀语义色修饰符（本项目扩展简写）
 *   别名归一：danger/warn/caution → error；success/info/note → tip；…
 *
 * ## 为什么在 rehype 阶段实现（关键决策，勿回退）
 *
 * 最初按 remark 插件实现（产出 `mdxJsxTextElement`）——**实测失败**：
 * `mdast-util-mdx-jsx` 序列化「程序化构造」的行内 JSX 节点时会回写为源码形态，
 * 再被 MDX 的表达式/JSX tokenizer 二次解析，`==tip:文本==` 最终渲染成
 * `==<!-- -->tip<div></div>` 这种残骸。
 *
 * 改到 **rehype 阶段直接产出 hast `<mark>` 元素**后，绕开了 MDX 的 JSX 序列化，
 * 输出稳定。同时 rehype 阶段看得到真实的 `pre`/`code` 元素边界，
 * 「代码内不触发渲染」的屏障更直观可靠。
 *
 * ## 与源码层哨兵的配合
 *
 * 源码层 `encodeMarkSyntax()`（src/lib/mdx.ts）在 MDX 解析前打哨兵 SENT：
 *   `\=\=`         → `SENT=SENT=`      （字面量 `==`，不触发高亮）
 *   `==x=={.tip}`  → `==x==SENT.tipSENT`（后缀；花括号必须消失否则 acorn 崩）
 *
 * 本插件解读哨兵并还原。
 * ==========================================================================*/

/** 源码层哨兵（须与 src/lib/mdx.ts 的 SENT 一致）：私有区字符，正文不会自然出现 */
const SENT = '\uE000';

/**
 * 第二哨兵（须与 src/lib/mdx.ts 的 SENT2 一致）：受保护的花括号。
 * 形态 `SENT2L` / `SENT2R` → 还原为 `{` / `}`。
 */
const SENT2 = '\uE001';

/** 支持的语义色角色（对齐 M3E：primary / secondary / tertiary / error / tip） */
export const MARK_VARIANTS = ['primary', 'secondary', 'tertiary', 'error', 'tip'] as const;
export type MarkVariant = (typeof MARK_VARIANTS)[number];

/** 变体别名归一（warn/caution/danger → error；success/info/note → tip；…） */
const MARK_VARIANT_ALIASES: Record<string, MarkVariant> = {
  primary: 'primary', main: 'primary', default: 'primary',
  secondary: 'secondary', sub: 'secondary',
  tertiary: 'tertiary', third: 'tertiary',
  error: 'error', danger: 'error', warning: 'error', warn: 'error', caution: 'error',
  tip: 'tip', success: 'tip', info: 'tip', note: 'tip', hint: 'tip',
};

/**
 * 后缀修饰符（源码层哨兵形态）：`SENT.tipSENT`。
 * 同时容忍未编码的退化形态 `{.tip}`，便于单测/其他调用方直接使用。
 */
const MARK_SUFFIX_RE = new RegExp(
  `^(?:${SENT}\\s*\\.?([A-Za-z][\\w-]*)\\s*${SENT}|\\{\\s*\\.?([A-Za-z][\\w-]*)\\s*\\})`,
);

/** `==` 定界符 */
const MARK_TOKEN = '==';

/** 字面量等号的哨兵形态（源码层 `\=` 的编码）；还原时变回 `=` */
const LITERAL_EQ = `${SENT}=`;

/** 归一化变体名（大小写不敏感 + 别名映射）；非法名返回 null */
function normalizeVariant(raw: string): MarkVariant | null {
  return MARK_VARIANT_ALIASES[raw.toLowerCase()] ?? null;
}

/** 从前缀/后缀正则结果里取变体名（两种捕获组形态二选一） */
function variantFromMatch(m: RegExpExecArray): MarkVariant | null {
  return normalizeVariant(m[1] ?? m[2] ?? '');
}

/**
 * 尝试消费「后缀修饰符」：命中且**变体名合法**时返回消费长度与变体，否则返回 null。
 *
 * 只在合法时消费：非法后缀名（如 `{.notavariant}`）应原样保留为字面文本，
 * 不能被静默吞掉——那属于无声的数据丢失。
 */
function consumeSuffix(rest: string): { len: number; variant: MarkVariant } | null {
  const m = MARK_SUFFIX_RE.exec(rest);
  if (!m) return null;
  const v = variantFromMatch(m);
  if (!v) return null;
  return { len: m[0].length, variant: v };
}

/**
 * 还原哨兵为作者可读原文：
 * - `SENT=` → `=`（字面量等号）
 * - 残留 `SENT` → `` （后缀包裹用的哨兵，后缀已被摘除）
 * - `SENT2L` / `SENT2R` → `{` / `}`（受保护的字面花括号，如非法后缀 `{.x}`）
 */
function decodeSentinel(text: string): string {
  if (!text.includes(SENT) && !text.includes(SENT2)) return text;
  return text
    .split(LITERAL_EQ)
    .join('=')
    .split(`${SENT2}L`)
    .join('{')
    .split(`${SENT2}R`)
    .join('}')
    .split(SENT)
    .join('');
}

/**
 * 在文本里找下一个**真定界符** `==`。
 *
 * 需要跳过两类哨兵形态：
 * 1. `SENT=`  —— 字面量等号（源码层 `\=` 的编码）
 * 2. `SENT=SENT=` —— **开标记的编码**（源码层 `==` 的编码，用于前缀写法
 *    `==tip:x==` 以及字面量 `\=\=`）
 *
 * 判定规则：若 `==` 前面紧邻哨兵，则该 `==` 属于编码形态，跳过。
 * 例：`SENT=SENT=tip:正文==` 中首个真定界符是末尾的 `==`。
 */
function findToken(text: string, from = 0): number {
  let at = text.indexOf(MARK_TOKEN, from);
  while (at !== -1) {
    if (at > 0 && text[at - 1] === SENT) {
      at = text.indexOf(MARK_TOKEN, at + MARK_TOKEN.length);
      continue;
    }
    return at;
  }
  return -1;
}

/**
 * 识别并消费「前缀开标记编码」：`SENT=SENT=tipSENT` → 变体 tip，返回已消费长度。
 *
 * 源码层把 `==tip:` 编码为 `SENT=SENT=tipSENT`：
 * - 首个 `=` 前有哨兵 → findToken 跳过（避开 MDX 表达式解析）
 * - 冒号替换为哨兵 → 避开 remark-directive 的 textDirective 解析
 * 因此插件在此处主动识别该形态作为**开标记**。
 */
const MARK_OPEN_PREFIX_RE = new RegExp(`^${SENT}=${SENT}=([A-Za-z][\\w-]*)${SENT}[ \\t]*`);

/**
 * 识别并消费「字面量 `==` 编码」：`SENT=SENT=` → 还原为字面 `==`，返回已消费长度。
 * （只有当它**不是**前缀开标记、也不是真定界符时才走到这里）
 */
const MARK_OPEN_LITERAL_RE = new RegExp(`^${SENT}=${SENT}=`);

/** 构造 `<mark class="mark mark-{variant}" data-mark="{variant}">` hast 元素 */
function makeMarkElement(children: ElementContent[], variant: MarkVariant): Element {
  return {
    type: 'element',
    tagName: 'mark',
    properties: {
      className: variant === 'primary' ? ['mark', 'mark-primary'] : ['mark', `mark-${variant}`],
      'data-mark': variant,
    },
    children,
  };
}

/** 文本 hast 节点 */
function hastText(value: string): ElementContent {
  return { type: 'text', value };
}

/**
 * 在单个 hast 文本节点序列里完成高亮转换。
 *
 * 返回新子级数组。为支持「跨节点嵌套」（`==a <strong>b</strong> c==`），
 * 采用「开标记 → 收集 → 闭合」的状态机，非文本元素在打开状态下被收进内容。
 */
function convertChildren(children: ElementContent[]): ElementContent[] {
  const out: ElementContent[] = [];
  /**
   * 状态收敛到一个对象里。
   *
   * ⚠️ 不要拆成多个 `let` 局部变量：`collected` 只在闭包（openMark/closeMark/rollback）
   * 内被赋值，TS 的控制流分析在循环体内会认为它恒为初始值 `null`，
   * `collected !== null` 分支里类型被窄化为 `never`，所有 `.push()` 报错。
   * 挂在对象属性上可阻断该窄化（TS 不做跨闭包属性窄化）。
   */
  interface MarkState {
    /** 已收集内容；null = 未打开 */
    collected: ElementContent[] | null;
    /** 打开时已确定的变体（前缀写法）；后缀可在闭合时覆盖 */
    openVariant: MarkVariant | null;
    /** 打开时的原文形态（未闭合回滚用，如 `==` / `==tip:`） */
    opener: string;
    /** 打开前已写入 `out` 的内容数（回滚点）；-1 = 本节点内打开 */
    openAt: number;
  }
  const S: MarkState = { collected: null, openVariant: null, opener: MARK_TOKEN, openAt: -1 };

  /** 闭合当前高亮 */
  const closeMark = (variant: MarkVariant): void => {
    out.push(makeMarkElement(S.collected ?? [], variant));
    S.collected = null;
    S.openVariant = null;
    S.opener = MARK_TOKEN;
    S.openAt = -1;
  };

  /** 未闭合回滚：把 opener 与已收集内容按原文还原 */
  const rollback = (): void => {
    const restored: ElementContent[] = [hastText(S.opener), ...(S.collected ?? [])];
    if (S.openAt >= 0) out.splice(S.openAt, out.length - S.openAt, ...restored);
    else out.push(...restored);
    S.collected = null;
    S.openVariant = null;
    S.opener = MARK_TOKEN;
    S.openAt = -1;
  };

  /** 打开一个高亮（进入收集态） */
  const openMark = (body: string, variant: MarkVariant | null, openText: string): void => {
    S.openAt = out.length;
    S.opener = openText;
    S.openVariant = variant;
    S.collected = body !== '' ? [hastText(decodeSentinel(body))] : [];
  };

  for (const child of children) {
    // 非文本元素：打开态则收进内容（支持 `==a <strong>b</strong> c==`）
    if (child.type !== 'text') {
      if (S.collected !== null) S.collected.push(child);
      else out.push(child);
      continue;
    }

    let value = child.value;

    // ── 打开态：只找闭合 ────────────────────────────────────────────
    if (S.collected !== null) {
      const closeAt = findToken(value);
      if (closeAt === -1) {
        if (value !== '') S.collected.push(hastText(decodeSentinel(value)));
        continue;
      }
      if (closeAt > 0) S.collected.push(hastText(decodeSentinel(value.slice(0, closeAt))));
      let rest = value.slice(closeAt + MARK_TOKEN.length);
      let final: MarkVariant = S.openVariant ?? 'primary';
      const sfx = consumeSuffix(rest);
      if (sfx) {
        final = sfx.variant;
        rest = rest.slice(sfx.len);
      }
      closeMark(final);
      value = rest; // 余下文本继续按闭合态解析
      if (value === '') continue;
    }

    // ── 闭合态：逐个消费开标记 ──────────────────────────────────────
    let cursor = 0;
    for (;;) {
      // 先看当前位置是否就是「编码开标记」（`SENT=SENT=` 或 `SENT=SENT=tip:`）
      const atHead = value.slice(cursor);
      const encodedPrefix = MARK_OPEN_PREFIX_RE.exec(atHead);
      const encodedLiteral = MARK_OPEN_LITERAL_RE.exec(atHead);

      if (encodedPrefix) {
        const v = normalizeVariant(encodedPrefix[1] ?? '');
        // 合法变体名 → 前缀开标记
        if (v) {
          const body = atHead.slice(encodedPrefix[0].length);
          const closeAt = findToken(body);
          if (closeAt === -1) {
            // 未闭合 → 进入收集态（原文还原用 `==name:`）
            openMark(body, v, MARK_TOKEN + encodedPrefix[1] + ':');
            cursor = value.length;
            break;
          }
          const inner = body.slice(0, closeAt);
          let tail = body.slice(closeAt + MARK_TOKEN.length);
          let final: MarkVariant = v;
          const sfx = consumeSuffix(tail);
          if (sfx) {
            final = sfx.variant;
            tail = tail.slice(sfx.len);
          }
          out.push(makeMarkElement(inner !== '' ? [hastText(decodeSentinel(inner))] : [], final));
          value = tail;
          cursor = 0;
          continue;
        }
        // 变体名非法（不该发生，源码层已过滤）→ 当字面量处理
      }

      if (encodedLiteral) {
        // 字面 `==`：还原输出，继续往后找
        out.push(hastText(MARK_TOKEN));
        value = atHead.slice(encodedLiteral[0].length);
        cursor = 0;
        continue;
      }

      // 普通真定界符
      const open = findToken(value, cursor);
      if (open === -1) {
        const tail = value.slice(cursor);
        if (tail !== '') out.push(hastText(decodeSentinel(tail)));
        break;
      }
      const lead = value.slice(cursor, open);
      if (lead !== '') out.push(hastText(decodeSentinel(lead)));

      const rest = value.slice(open + MARK_TOKEN.length);
      const closeAt = findToken(rest);
      if (closeAt === -1) {
        openMark(rest, null, MARK_TOKEN);
        break;
      }
      const inner = rest.slice(0, closeAt);
      let tail = rest.slice(closeAt + MARK_TOKEN.length);
      let final: MarkVariant = 'primary';
      const sfx = consumeSuffix(tail);
      if (sfx) {
        final = sfx.variant;
        tail = tail.slice(sfx.len);
      }
      out.push(makeMarkElement(inner !== '' ? [hastText(decodeSentinel(inner))] : [], final));
      value = tail;
      cursor = 0;
    }
  }

  if (S.collected !== null) rollback();
  return out;
}

/**
 * 行内容器标签：只在这些元素上执行高亮转换。
 *
 * ⚠️ 不能包含 `div` / `aside` / `details` 这类**块级包装**元素：
 * 它们内部可能嵌套 `<p>`/`<ul>`/`<blockquote>` 等块级子元素，
 * 在这些包装层上做「行内序列扫描」会把跨块的内容当成同一行处理，
 * 导致定界符被提前消费、后代块内的标记反而失效（实测 Callout 标题/正文即如此）。
 * 正确做法是在**真正承载行内内容的最小容器**（p / li / td / h2…）上转换，
 * 由 walk 逐层下钻自然覆盖全部正文。
 */
const MARK_CONTAINER_TAGS = new Set([
  'p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'summary', 'figcaption', 'dt', 'dd', 'caption',
]);

/**
 * rehype 插件：把 `==文本==` 转换 `<mark class="mark mark-*">` 元素。
 *
 * 屏障（天然满足「代码内不触发」）：
 * - `pre` / `code` / `kbd` / `samp` / `script` / `style` 一律不下钻，
 *   围栏代码块与行内代码内容原样保留；
 * - 公式 `katex` 子树不下钻（避免把 `==` 拼进公式语义）。
 */
export function rehypeMark() {
  return (tree: HastRoot) => {
    const SKIP = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'textarea']);
    /**
     * 下钻遍历。
     *
     * ⚠️ 必须同时识别 MDX 的 JSX 节点（`mdxJsxFlowElement` / `mdxJsxTextElement`）：
     * `<Callout>` 是 React 组件，在 rehype 阶段仍是 `mdxJsxFlowElement`，
     * 其内部承载行内的 `<p data-callout-head>`（标题行）同样是 JSX 节点而非 hast
     * `element`。若只认 `element`，整棵 Callout 子树会被跳过，
     * 标题行与正文里的 `==…==` 都不会转换（实测现象）。
     */
    /**
     * 通用树节点（hast element / hast root / MDX JSX 节点）。
     * 本插件同时处理三类节点，用结构化最小接口而非完整 hast 联合类型，
     * 避免 mdast / hast 的 `Root` 类型互不兼容导致的赋值报错。
     */
    interface WalkNode {
      type?: string;
      tagName?: string;
      name?: string;
      properties?: Record<string, unknown>;
      children?: ElementContent[];
    }

    const walk = (node: WalkNode): void => {
      if (!Array.isArray(node.children)) return;
      const t = node.type;

      if (t === 'element') {
        const tagName = String(node.tagName ?? '');
        if (SKIP.has(tagName)) return;
        // KaTeX 子树不下钻（.katex / .katex-mathml 内部是排版产物）
        const cls = classListOf(node as unknown as Element);
        if (cls.includes('katex') || cls.includes('katex-mathml')) return;
        if (MARK_CONTAINER_TAGS.has(tagName)) {
          node.children = convertChildren(node.children);
        }
      } else if (t === 'mdxJsxFlowElement' || t === 'mdxJsxTextElement') {
        // JSX 元素：按标签名判定容器。组件本身（如 Callout）不扫描（其子级由下钻覆盖），
        // 但内部的原生小写标签（`p`/`li`/…）仍是**行内容器**，需要在此转换。
        const name = String(node.name ?? '');
        if (MARK_CONTAINER_TAGS.has(name)) {
          node.children = convertChildren(node.children);
        }
      }

      for (const child of node.children) {
        const ct = (child as unknown as WalkNode).type;
        if (ct === 'element' || ct === 'mdxJsxFlowElement' || ct === 'mdxJsxTextElement') {
          walk(child as unknown as WalkNode);
        }
      }
    };
    walk(tree as unknown as WalkNode);
  };
}

/** 读取元素 class 列表 */
function classListOf(node: Element): string[] {
  // hast 的 className 类型在不同子包里声明不一（string / string[] / 混合），统一按 unknown 收窄
  const cls = node.properties?.className as unknown;
  if (Array.isArray(cls)) return cls.map((c) => String(c));
  if (typeof cls === 'string') return cls.split(/\s+/).filter(Boolean);
  return [];
}

/** 在 KaTeX 节点内找 LaTeX 源码（annotation encoding="application/x-tex"） */
function findTexSource(node: Element): string {
  let out = '';
  const walk = (n: Element | ElementContent): void => {
    if (n.type === 'element' && n.tagName === 'annotation') {
      const enc = n.properties?.encoding;
      if (enc === 'application/x-tex' && Array.isArray(n.children)) {
        out = n.children.map((c) => (c.type === 'text' ? String(c.value ?? '') : '')).join('').trim();
      }
    }
    if (n.type === 'element' && Array.isArray(n.children)) {
      n.children.forEach((c) => walk(c as ElementContent));
    }
  };
  walk(node);
  return out;
}

/**
 * 递归提取标题纯文本（目录 text 字段）：
 * - 跳过 autolink 锚点 <a>（rehype-autolink-headings 注入的 # 链接）
 * - KaTeX 节点（.katex）取 annotation 里的 LaTeX 源码，跳过 MathML/视觉区避免重复噪音
 */
function textContent(node: ElementContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  if (node.type === 'element') {
    if (node.tagName === 'a') return '';
    const classes = classListOf(node);
    if (classes.includes('katex')) return findTexSource(node);
    if (classes.includes('katex-mathml')) return '';
    if (Array.isArray(node.children)) {
      return node.children.map((child) => textContent(child as ElementContent)).join('');
    }
  }
  return '';
}

/**
 * 序列化标题内层子树为 HTML（目录 html 字段，含 KaTeX 标记）。
 * 过滤 autolink <a> 子节点；KaTeX/strong/em/code 等富文本原样保留，
 * 依赖页面已引入的 katex.min.css 即可渲染公式。
 */
function tocHtml(node: Element): string {
  const children = (node.children ?? []).filter(
    (c) => !(c.type === 'element' && (c as Element).tagName === 'a'),
  );
  return children.map((c) => toHtml(c as ElementContent)).join('');
}

/**
 * remark 插件：兼容旧式数字注脚 `[1]`
 *
 * 支持两种写法（与 GFM 标准 `[^1]` 并存）：
 * 1. 正文引用：文本中出现 `[12]` → 转为 footnoteReference（跳过链接/图片等已有语义上下文）
 * 2. 底部定义：段落以 `[1] 注释内容…` 开头 → 转为 footnoteDefinition
 *
 * 转换后的节点交给 remark-gfm 渲染：正文生成 `<sup><a href="#user-content-fn-N">[N]</a></sup>`，
 * 底部生成注脚区 `<li id="user-content-fn-N">… <a href="#user-content-fnref-N">↩</a></li>`，
 * 实现"点击 [N] 跳到底部注脚 + ↩ 跳回引用处"的双向跳转。
 */
export function remarkLegacyFootnotes() {
  return (tree: Root) => {
    const REF_RE = /\[(\d{1,3})\]/g;

    /** 拆分文本节点中的 [数字] 引用，返回新子级数组 */
    function splitTextRefs(children: Node[]): Node[] {
      const out: Node[] = [];
      for (const node of children) {
        if (node.type === 'text') {
          const value = (node as { value?: unknown }).value as string | undefined ?? '';
          let last = 0;
          let m: RegExpExecArray | null;
          REF_RE.lastIndex = 0;
          let matched = false;
          while ((m = REF_RE.exec(value)) !== null) {
            matched = true;
            if (m.index > last) {
              out.push({ type: 'text', value: value.slice(last, m.index) } as Node);
            }
            out.push({
              type: 'footnoteReference',
              identifier: m[1]!,
              label: m[1]!,
            } as unknown as Node);
            last = m.index + m[0].length;
          }
          if (!matched) {
            out.push(node);
          } else if (last < value.length) {
            out.push({ type: 'text', value: value.slice(last) } as Node);
          }
        } else {
          // 非文本节点（strong/em/行内代码/链接/图片）：不拆分其内部 [x]
          out.push(node);
        }
      }
      return out;
    }

    /** 递归遍历整棵树 */
    function walk(node: Node): void {
      const children = (node as { children?: Node[] }).children;
      if (!Array.isArray(children)) return;

      for (let i = 0; i < children.length; i += 1) {
        const child = children[i]!;
        if (child.type === 'paragraph') {
          const para = child as { children?: Node[] };
          const paraChildren = para.children ?? [];
          const first = paraChildren[0] as { type?: string; value?: unknown } | undefined;
          if (first && first.type === 'text') {
            const firstText = String(first.value ?? '');
            const defMatch = /^\[(\d{1,3})\]\s+/.exec(firstText);
            if (defMatch) {
              const id = defMatch[1]!;
              const rest: Node[] = [];
              const prefixLen = defMatch[0].length;
              if (firstText.length > prefixLen) {
                rest.push({ type: 'text', value: firstText.slice(prefixLen) } as Node);
              }
              rest.push(...paraChildren.slice(1));
              children[i] = {
                type: 'footnoteDefinition',
                identifier: id,
                label: id,
                children: [{ type: 'paragraph', children: rest }],
              } as unknown as Node;
              continue;
            }
          }
          // 段落内文本引用（仅处理文本节点，链接/图片内部不动）
          para.children = splitTextRefs(paraChildren);
        } else {
          walk(child);
        }
      }
    }

    walk(tree);
  };
}

/**
 * rehype 插件：采集 h2/h3/h4 标题到 `file.data.toc`。
 * 必须在 `rehype-slug` 之后运行以获得标题 id；
 * 若管线含 `rehype-katex`，须在其之后运行，html 字段才能带上公式标记。
 */
export function rehypeTocCollector() {
  return (tree: HastRoot, file: { data: Record<string, unknown> }) => {
    const toc: TocItem[] = [];
    const walk = (node: Element | HastRoot): void => {
      if (node.type === 'element') {
        if (node.tagName === 'h2' || node.tagName === 'h3' || node.tagName === 'h4') {
          const id = node.properties?.id;
          if (typeof id === 'string') {
            const level = node.tagName === 'h2' ? 2 : node.tagName === 'h3' ? 3 : 4;
            toc.push({
              id,
              text: textContent(node).trim() || id,
              level,
              html: tocHtml(node) || undefined,
            });
          }
        }
        if (Array.isArray(node.children)) {
          node.children.forEach((child) => walk(child as Element));
        }
      } else if (Array.isArray(node.children)) {
        node.children.forEach((child) => walk(child as Element));
      }
    };
    walk(tree);
    file.data.toc = toc;
  };
}

/**
 * remark 插件：修正 GFM autolinkLiteral 的中文边界 bug
 *
 * 背景（复现+生产确认）：GFM 的裸 URL 自动链接只认「空白 / 部分 ASCII 标点」边界，
 * URL 后紧跟全角标点（。？！：；、）或反引号时会把这些字符连同后续文本一直吞进链接
 * ——例如「https://example.com。提交链：`abc`」整段变成一个 <a>，code span 失效、
 * 反引号字面残留（编辑器实时渲染用另一套解析所以正常，阅读页异常）。
 *
 * 修复：遍历 mdast，命中「GFM autolink 特征」的 link 节点（纯文本子节点且文本与 url
 * 完全一致，手动 `[text](url)` 一般不满足）且 url 含全角标点/反引号时：
 * - url 截断到第一个非法字符前，重写为干净链接；
 * - 截下的剩余文本重新过 remark-parse（行内结构如 code span 得以恢复）后插回链接之后。
 * 手动链接（文本≠url）与代码块内的 URL 不受影响（后者根本不生成 autolink）。
 */
const AUTOLINK_BREAK_RE = /[\u3000-\u303F\uFF00-\uFFEF\u2018-\u201D\u2010-\u2015\u2026`]/;

export function remarkFixGfmAutolink(this: Processor) {
  const proc = this;
  return (tree: Root) => {
    const walk = (node: Node): void => {
      const children = (node as { children?: Node[] }).children;
      if (!Array.isArray(children)) return;
      const out: Node[] = [];
      for (const child of children) {
        if (child.type === 'link') {
          const link = child as { url?: unknown; title?: unknown; children?: Node[] };
          const url = typeof link.url === 'string' ? link.url : '';
          const kids = Array.isArray(link.children) ? link.children : [];
          const isPureText = kids.length > 0 && kids.every((k) => k.type === 'text');
          const text = kids.map((k) => (k.type === 'text' ? String((k as { value?: unknown }).value ?? '') : '')).join('');
          if (url && isPureText && text === url && /^https?:\/\//i.test(url) && AUTOLINK_BREAK_RE.test(url)) {
            const cut = url.search(AUTOLINK_BREAK_RE);
            const good = url.slice(0, cut);
            const rest = url.slice(cut);
            out.push({
              type: 'link',
              url: good,
              title: (link.title as string | null) ?? null,
              children: [{ type: 'text', value: good } as Node],
            } as Node);
            if (rest) {
              // 剩余文本重新按行内 Markdown 解析（恢复 `code`、强调等结构）
              try {
                const reparsed = proc.parse(rest) as Root;
                const para = reparsed.children.find((c) => c.type === 'paragraph') as Paragraph | undefined;
                out.push(...((para?.children ?? [{ type: 'text', value: rest } as Node]) as Node[]));
              } catch {
                out.push({ type: 'text', value: rest } as Node);
              }
            }
            continue;
          }
        }
        walk(child);
        out.push(child);
      }
      children.length = 0;
      children.push(...out);
    };
    walk(tree);
  };
}

/** remark 插件数组（evaluate 与预览共用） */
export const remarkPlugins = [
  remarkGfm,
  remarkFixGfmAutolink,
  remarkMath,
  remarkDirective,
  remarkDirectiveToJsx,
  // Obsidian 风格 `> [!type]` 引用块 → <Callout>（须在 remarkGfm 之后，blockquote 已解析成型）
  remarkCallout,
  // `:::collapse` 折叠面板容器 → <Collapse>（须在 remarkDirective 之后，容器已解析成型）
  remarkCollapse,
  // `:::tabs#id` 选项卡组 → <Tabs>（须在 remarkDirective 之后，容器已解析成型）
  remarkTabs,
  remarkLegacyFootnotes,
];

/**
 * rehype 插件数组：slug → autolink → katex（LaTeX 公式，纯 CSS 渲染无需客户端 JS）
 * → prism（行号）→ 荧光高亮 → 块锚点（思维导图引用）
 *
 * 顺序说明：
 * - `rehypeMark` 在 `rehypeKatex` **之后**：KaTeX 已渲染完公式，插件跳过 `.katex` 子树；
 * - `rehypeMark` 在 `rehypeBlockAnchors` **之后**：块锚点先给块级元素挂 id，
 *   高亮只改行内内容，不影响块级结构（顺序其实无关，但保持「结构先定、内容后改」）。
 */
export const rehypePlugins = [
  rehypeSlug,
  rehypeAutolinkHeadings,
  [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
  // 表格 cell 内 remark-math 不激活 → 二次扫描 cell text 节点中 $…$ 段用 KaTeX 渲染
  rehypeTableMath,
  [rehypePrismPlus, { showLineNumbers: true, ignoreMissing: true }],
  rehypeBlockAnchors,
  // M3E 风格荧光高亮 `==文本==` → <mark>（须在 KaTeX 之后，跳过公式子树）
  rehypeMark,
];
