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

/** 便捷类型：含可选 name/children 的节点 */
type DirectiveNode = Node & { name?: string; children?: Node[] };

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
            walk(body);
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
  remarkLegacyFootnotes,
];

/** rehype 插件数组：slug → autolink → katex（LaTeX 公式，纯 CSS 渲染无需客户端 JS）→ prism（行号）→ 块锚点（思维导图引用） */
export const rehypePlugins = [
  rehypeSlug,
  rehypeAutolinkHeadings,
  [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
  // 表格 cell 内 remark-math 不激活 → 二次扫描 cell text 节点中 $…$ 段用 KaTeX 渲染
  rehypeTableMath,
  [rehypePrismPlus, { showLineNumbers: true, ignoreMissing: true }],
  rehypeBlockAnchors,
];
