/**
 * admonition.ts —— `:::note/tip/warning/danger/info` 容器指令的 Tiptap 节点
 *
 * 用途：文档详情页就地编辑时，把 markdown 里的 `:::type … :::` 解析为可编辑的
 * admonition 容器节点（编辑态即渲染态，五类语义色带与阅读一致）。
 *
 * 与服务端管线的对齐（勿偏移）：
 * - 服务端（mdx-plugins.ts remarkDirectiveToJsx）仅识别 ADMONITION_TYPES 五类，
 *   容器体为任意块级内容；渲染为 <Admonition type>（HTML: aside[data-admonition]）。
 * - 本节点 renderHTML 输出同构的 `aside[data-admonition]` 结构，阅读/编辑两侧
 *   复用同一份 global.css 的 .admonition 语义色带（1389 行起）。
 * - round-trip 方向：markdown `:::note\n…\n:::` → admonition 节点 → 还原 `:::note`。
 *   自定义标题语法（:::note 标题）两端均未支持，不在此节点引入（保持对齐）。
 *
 * 实现参照 Tiptap 官方指南「Create an Admonition Block with Markdown Support」。
 */
import { Node } from '@tiptap/core';
import type { MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken, MarkdownParseResult } from '@tiptap/core';

/** 与服务端 ADMONITION_TYPES 保持一致（mdx-plugins.ts） */
export const ADMONITION_TYPES = ['note', 'tip', 'warning', 'danger', 'info'] as const;
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];

export interface AdmonitionOptions {
  /** 默认容器类型（node.attrs.type 缺省值） */
  defaultType: AdmonitionType;
  /** markdownTokenizer 里可用；如不限制则传空数组 */
  types: readonly AdmonitionType[];
}

/** markdown `:::` 容器解析正则：`:::type\n内容\n:::`（type 限五类） */
const ADMONITION_RE = /^:::([a-z]+)\n([\s\S]*?)\n:::\n?/;
/** 模块级常量：避免在 parseMarkdown/renderMarkdown 回调内依赖 this（调用方为 spec） */
const NODE_NAME = 'admonition';
const DEFAULT_ADMONITION_TYPE: AdmonitionType = 'note';

export const Admonition = Node.create<AdmonitionOptions>({
  name: 'admonition',
  group: 'block',
  content: 'block+', // 容器体内允许任意块级（段落/列表/公式/子容器等）
  defining: true, // 回车时不会跳出容器结构（与 blockquote 同级语义）

  addOptions() {
    return { defaultType: 'note', types: ADMONITION_TYPES };
  },

  addAttributes() {
    return {
      type: {
        default: this.options.defaultType,
        parseHTML: (element) => element.getAttribute('data-admonition') ?? this.options.defaultType,
        renderHTML: (attributes) => ({ 'data-admonition': attributes.type as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-admonition]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // 与服务端 <Admonition> 输出同构：aside[data-admonition] 内嵌容器体。
    // title 栏为视觉装饰（服务端由默认文案渲染），不进入文档模型。
    return ['aside', { class: 'admonition doc-admonition-edit', ...HTMLAttributes, role: 'note' }, ['div', { class: 'admonition-body' }, 0]];
  },

  addKeyboardShortcuts() {
    return {
      // 容器头部回车 / 末尾退格保持容器内语义；无独立命令（切换命令在前端工具条层实现）
      'Mod-Alt-Enter': () => false,
    };
  },

  /* ================= markdown 双向支持 ================= */

  markdownTokenName: 'admonition',

  /** 识别 `:::type` 块并交给 lexer 解析容器体（块级自定义语法） */
  markdownTokenizer: {
    name: 'admonition',
    level: 'block',
    start: (src: string) => src.indexOf(':::'),
    tokenize: (src: string, _tokens: MarkdownToken[], lexer: { blockTokens: (s: string) => MarkdownToken[] }) => {
      const match = ADMONITION_RE.exec(src);
      if (!match) return undefined;
      const [, type, body] = match as unknown as [string, string, string];
      // 未知类型（:::foo 等非五类）不接管——与服务端一致，留给原样文本/HTML 处理
      if (!ADMONITION_TYPES.includes(type as AdmonitionType)) return undefined;
      return {
        type: 'admonition',
        raw: match[0], // 完整匹配原文（含闭合 :::）
        admonitionType: type,
        tokens: lexer.blockTokens(body), // 容器体按块级递归解析
      };
    },
  },

  parseMarkdown(_token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult {
    // ⚠️ 此回调被 MarkdownManager 以 spec 为 this 调用，勿使用 this.name/this.options
    const t = _token as unknown as { admonitionType?: string; tokens?: MarkdownToken[] };
    const type = t.admonitionType ?? DEFAULT_ADMONITION_TYPE;
    return { type: NODE_NAME, attrs: { type }, content: helpers.parseBlockChildren?.(t.tokens ?? []) ?? [] };
  },

  renderMarkdown(node: { attrs?: { type?: string }; content?: Parameters<MarkdownRendererHelpers['renderChildren']>[0] }, helpers: MarkdownRendererHelpers): string {
    // ⚠️ 同上：this 非扩展实例
    const type = (node.attrs?.type as string) || DEFAULT_ADMONITION_TYPE;
    const inner = helpers.renderChildren(node.content ?? []).trimEnd();
    return `:::${type}\n${inner}\n:::`;
  },
});
