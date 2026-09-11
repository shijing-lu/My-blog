/**
 * MDX 渲染管线：统一 remark / rehype 插件 + 指令 → JSX + TOC 采集
 *
 * <!-- 区域划分 -->
 * - Imports: remark / rehype / mdast·hast 类型
 * - Directive: remarkDirectiveToJsx（:::指令 → Admonition JSX）
 * - BlockAnchors: rehypeBlockAnchors / rehypeSkipHugeCode
 * - Mark: 荧光高亮 `==文本==` → <mark>
 * - Toc: rehypeTocCollector（h2/h3 → TOC）
 * - Footnotes: remarkLegacyFootnotes（旧式 `[1]` 脚注）
 * - Plugins: 服务端与浏览器预览共用的插件数组
 *
 * ## P1-9 拆分说明
 * 本文件曾达 1599 行，四个语法块与公共插件挤在一起。现已按语法拆出：
 * - `./mdx/nodes` —— 节点构造助手（patched / jsxFlow / footnoteRef…），公共底座
 * - `./mdx/callout` —— `> [!type]` → <Callout>
 * - `./mdx/collapse` —— `:::collapse` → <Collapse>
 * - `./mdx/tabs` —— `:::tabs#id` → <Tabs>
 * 三者只依赖 `./mdx/nodes`，不反向依赖本文件（避免与插件数组的循环引用）。
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
import { footnoteDef, footnoteRef, textNode, type MdxDirectiveNode } from './mdx/nodes';
import { remarkCallout } from './mdx/callout';
import { remarkCollapse } from './mdx/collapse';
import { remarkTabs } from './mdx/tabs';
import type { Element, ElementContent, Root as HastRoot } from 'hast';

/* 节点助手已拆到 ./mdx/nodes（P1-9）；这里整体再导出，
   保持 `import { jsxFlow } from '@/lib/mdx-plugins'` 之类的旧写法仍然可用。 */
export * from './mdx/nodes';

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

/**
 * rehype 插件：超长代码块跳过高亮（P3-4）
 *
 * Prism 高亮是纯 CPU 活儿，耗时随代码长度线性增长。正常文章的代码块几百行以内，
 * 但偶尔会贴整份日志/大段配置，单个函数实例可能被拖到秒级。
 *
 * 做法：超过阈值的块**去掉 language-* 类**，让 rehype-prism-plus 直接跳过它
 * （无语言类 = 不加载语法 = 不高亮），内容一个字不少地照常输出。
 * 语言名另存到 `data-language`（供 UI/复制等后续逻辑读取），
 * 并打 `data-code-plain`，便于将来给这类块加"未高亮"提示。
 *
 * 只牺牲配色、不牺牲内容——这是刻意的取舍：截断正文会破坏文档完整性。
 */
const MAX_HIGHLIGHT_CHARS = 50_000;

/** 递归累加元素内纯文本长度（不做字符串拼接，避免为大块分配临时串） */
function textLength(node: Element | HastRoot): number {
  let sum = 0;
  const walk = (n: ElementContent | Element | HastRoot): void => {
    if (n.type === 'text') {
      sum += (n.value ?? '').length;
      return;
    }
    if (Array.isArray((n as Element).children)) {
      (n as Element).children.forEach((c) => walk(c as ElementContent));
    }
  };
  (node as Element).children?.forEach((c) => walk(c as ElementContent));
  return sum;
}

export function rehypeSkipHugeCode() {
  return (tree: HastRoot) => {
    const walk = (node: Element | HastRoot): void => {
      if (Array.isArray((node as HastRoot).children)) {
        (node as HastRoot).children.forEach((child) => {
          if (child.type === 'element') walk(child as Element);
        });
      }
      if (node.type !== 'element' || node.tagName !== 'pre') return;
      const code = (node as Element).children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'code',
      );
      if (!code) return;
      if (textLength(code) <= MAX_HIGHLIGHT_CHARS) return;
      const classes = Array.isArray(code.properties?.className) ? (code.properties!.className as string[]) : [];
      const lang = classes.find((c) => typeof c === 'string' && c.startsWith('language-'))?.slice('language-'.length);
      code.properties = {
        ...(code.properties ?? {}),
        className: classes.filter((c) => typeof c !== 'string' || !c.startsWith('language-')),
        ...(lang ? { dataLanguage: lang } : {}),
        dataCodePlain: 'true',
      };
    };
    walk(tree);
  };
}

/** 便捷类型：含可选 name/children/attributes 的节点（三个容器插件共用，已下沉到 nodes.ts）
 *  @deprecated 请从 `@/lib/mdx/nodes` 导入 `DirectiveNode`，此处仅为兼容旧引用保留别名。 */
type DirectiveNode = MdxDirectiveNode;

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
              out.push(textNode(value.slice(last, m.index)));
            }
            out.push(footnoteRef(m[1]!));
            last = m.index + m[0].length;
          }
          if (!matched) {
            out.push(node);
          } else if (last < value.length) {
            out.push(textNode(value.slice(last)));
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
                rest.push(textNode(firstText.slice(prefixLen)));
              }
              rest.push(...paraChildren.slice(1));
              children[i] = footnoteDef(id, rest);
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
  // 超长代码块先摘掉 language 类，让下游 Prism 跳过（P3-4，须在 rehypePrismPlus 之前）
  rehypeSkipHugeCode,
  [rehypePrismPlus, { showLineNumbers: true, ignoreMissing: true }],
  rehypeBlockAnchors,
  // M3E 风格荧光高亮 `==文本==` → <mark>（须在 KaTeX 之后，跳过公式子树）
  rehypeMark,
];
