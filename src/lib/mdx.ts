/**
 * MDX 服务端渲染引擎（evaluate 模式）
 *
 * <!-- 区域划分 -->
 * - Imports: React / react-dom/server / react/jsx-runtime / @mdx-js/mdx / unified 管线 / 注册表 / 插件
 * - Toc: extractToc（独立轻量管线提取目录，避免依赖 evaluate 中间数据）
 * - Render: renderMdx（evaluate → renderToString）
 */
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { evaluate } from '@mdx-js/mdx';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import rehypeParse from 'rehype-parse';
import { remarkPlugins, rehypePlugins, rehypeTocCollector, type TocItem, type BlockAnchorMap, type BlockAnchorItem } from './mdx-plugins';
import { mdxComponents, type MDXComponentMap } from '@/components/mdx/registry';

/** 渲染选项 */
export interface RenderOptions {
  /** 额外覆盖的组件映射（与默认注册表合并） */
  components?: MDXComponentMap;
}

/* ============== renderMdx 内存 LRU 缓存 ==============
 * 切换同一篇文章第二次起几乎零延迟；高频访问受益显著。
 * - key 用源码 hash（djb2 + length 防碰撞），避免 Map 直接持有大字符串作 key
 * - 容量 100 条；Map 按插入顺序，超限驱逐最旧
 * - 仅在无自定义 components 时生效（自定义组件会改变渲染结果）
 * - 单 Vercel Function 实例；冷启动清空；文档更新后由调用方在 cacheKey 上拼 updatedAt
 * ======================================================= */
const RENDER_CACHE_MAX = 100;
const RENDER_CACHE = new Map<string, RenderedMdx>();

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) + s.charCodeAt(i)) | 0;
  return `${h}_${s.length}`;
}

function cacheGet(key: string): RenderedMdx | null {
  const hit = RENDER_CACHE.get(key);
  if (!hit) return null;
  // 命中后提升到队尾（LRU 语义）
  RENDER_CACHE.delete(key);
  RENDER_CACHE.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: RenderedMdx): void {
  if (RENDER_CACHE.has(key)) RENDER_CACHE.delete(key);
  RENDER_CACHE.set(key, value);
  while (RENDER_CACHE.size > RENDER_CACHE_MAX) {
    const oldest = RENDER_CACHE.keys().next().value;
    if (oldest === undefined) break;
    RENDER_CACHE.delete(oldest);
  }
}

/** 显式失效某源码的渲染缓存（文档更新时由调用方触发） */
export function invalidateRenderCache(source: string): void {
  RENDER_CACHE.delete(djb2(source));
}

/** 清空全部渲染缓存（删除/批量操作等场景使用，LRU 也会自然驱逐） */
export function clearRenderCache(): void {
  RENDER_CACHE.clear();
}

/**
 * 反引号变体 → ASCII 反引号（U+0060）
 *
 * 中文输入法 / 智能编辑器（Word、微信、Notion 等）常产生视觉上等同反引号、
 * 但 Unicode 码位不同的字符（全角 ｀、修饰符重音符 ˋ、反向撇号 ‵ 等）。
 * Markdown 只把 U+0060 识别为行内代码定界符，其余字符会被原样输出，
 * 造成「行内代码渲染失败、仍然出现反引号」的观感。
 * 这里仅映射**几乎不会在正文中作为标点使用**的变体，不触碰弯引号（‘’），
 * 以免把正常引用的散文误判为代码定界符。
 */
const BACKTICK_VARIANT_RE = /[\uFF40\u02CB\u2035]/g;

/** 把源码中的反引号变体统一规范化为 ASCII 反引号（不改动其余内容） */
export function normalizeBackticks(source: string): string {
  return source.replace(BACKTICK_VARIANT_RE, '`');
}

/**
 * 数学块分隔符规整：把文档中所有「意图为 display math」的 `$$` 规范为独立 fence 行。
 *
 * 背景（根因，本地复现 + 生产 6 篇文章确认）：
 * remark-math（micromark mathFlow）只认 **`$$` fence 独占一行** 的 display 数学。
 * 实测其不支持/错吞的形态：
 * - `$$x^2$$` 同行成对           → 完全不被识别，字面显示
 * - `$$\nx^2$$` 行尾闭合与内容同行 → math value 吞入后续正文 + 残留 `$$`
 * - `$$ \begin{cases}…` open 与内容同行 → 同上，KaTeX 收到含 `$$` 的非法 TeX
 *                                   → throwOnError:false 输出 `.katex-error` 红字
 * 编辑器（cm-wysiwyg 词法）对 `$$` 位置不敏感 → 同一内容渲染正常 →
 * 表现为「编辑正常、阅读红字」。
 *
 * 修复：逐行把每个**非转义** `$$` 拆到独占行（等价于把 display 数学写规范），
 * 让 remark-math 正确闭合、KaTeX 收到纯净公式。
 * 保守策略（防误伤，勿回退）：
 * - ``` / ~~~ 代码围栏内容整行跳过（状态机跟踪，含语言标记行）；
 * - 含反引号的行跳过（行内代码里的 `$$` 是字面，拆分会改坏代码）；
 * - `\$` 转义美元保留原样（想显示字面 `$$` 请写作 `\$\$$`）；
 * - 单个 `$` 的行内数学不受影响（只拆连续两个 `$`）。
 */
/**
 * 渲染前源码规整（数学 + MDX 安全化）。含两类修复，按行分类处理：
 *
 * ① 数学块分隔符（非表格行）：把「意图为 display math」的非转义 `$$` 拆到独占行。
 *    背景（复现+生产确认）：remark-math（micromark mathFlow）只认 `$$` fence 独占一行；
 *    `$$x^2$$` 同行成对不被识别、`内容与 $$ 同行`会吞后续正文+残留 `$$` →
 *    KaTeX 收到含 `$$` 的非法 TeX → `.katex-error` 红字（「编辑正常、阅读红字」根因）。
 *
 * ② 表格行：remark-math 的 `$…$` 在 GFM 表格单元格内**不激活**
 *    （micromark-extension-gfm-table 的 cell tokenizer 不含 math text tokenizer，
 *      与插件顺序无关，实测确认）。于是表格里的 LaTeX 花括号 `{dx}`、`{2a}` 会以
 *     **裸文本**进入 MDX → micromark-extension-mdx-expression 把 `{` 当 JS 表达式 →
 *     acorn 解析 `{2a}` 抛「Identifier directly after number」→ 整篇 evaluate 失败
 *     （/render 500，生产日志 api/doc/nodes/render 50:103 即积分公式表）。
 *     处理：剥掉成对 `$`（以干净字面 LaTeX 显示），裸 `{`/`}` 转义为 `\{`/`\}`。
 *     （备注：曾试过表格 cell 内嵌 `<Tex/>` JSX 组件渲染 KaTeX——cell 内 JSX 属性
 *      不支持反斜杠转义/表达式属性，micromark 限制，放弃；Tex 组件保留供段落下
 *      显式内嵌公式使用。）
 *
 * 保守策略（防误伤，勿回退）：
 * - ``` / ~~~ 围栏内容整行跳过（状态机）；缩进 ≥4 空格的缩进代码行跳过；
 * - 含反引号的行跳过（行内代码里的标记是字面，改坏代码）；
 * - `\$` 转义保留；单个 `$` 行内数学不受影响（只拆连续两个 `$`）；
 * - 表格行判定：顶格或缩进 ≤3 且行首为 `|`（GFM 表格数据行特征）。
 */
export function normalizeMathFences(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const raw of lines) {
    const t = raw;
    // 围栏状态机：``` 或 ~~~ 起止（整行匹配围栏标记，含语言说明）
    if (/^\s*(?:```+|~~~+)/.test(t)) {
      inFence = !inFence;
      out.push(t);
      continue;
    }
    if (inFence || t.includes('`')) {
      out.push(t);
      continue;
    }
    // ② 表格数据行（顶格/≤3 缩进 + 行首 `|`）：remark-math 的 `$…$` 在 GFM 表格
    //    cell 内不激活 → 剥掉 `$` 以干净字面 LaTeX 显示，并把裸 `{`/`}` 转义为
    //    `\{`/`\}`（MDX 文本原样输出），阻止表达式解析崩溃（见 tableLineToSafe）。
    //    ⚠️ 勿加「缩进 ≥4 空格行跳过」分支：列表/引用内常有缩进 display 数学
    //    （如 `  $$ … $$`），跳过会破坏其拆分（曾在生产文档引发 acorn 崩溃回归）。
    if (/^\s{0,3}\|/.test(t)) {
      out.push(tableLineToSafe(t));
      continue;
    }
    // ① 非表格行：拆分行内所有非转义 `$$` 为独立行（每段一行，保持内容原样）
    const segs: string[] = [];
    let buf = '';
    for (let i = 0; i < t.length; ) {
      if (t[i] === '\\' && t[i + 1] === '$') {
        buf += '\\$';
        i += 2;
        continue;
      }
      if (t[i] === '$' && t[i + 1] === '$') {
        if (buf.trim() !== '') segs.push(buf.trimEnd());
        segs.push('$$');
        buf = '';
        i += 2;
        continue;
      }
      buf += t[i];
      i += 1;
    }
    if (buf.trim() !== '') segs.push(buf.trimEnd());
    // 行无 `$$` → 原样输出
    if (segs.length === 0) {
      out.push(t);
    } else if (segs.length === 1 && segs[0] === '$$' && /^\s*\$\$\s*$/.test(t)) {
      out.push(t); // 已是标准独立 fence 行：保持原样（含缩进/尾空格）
    } else {
      out.push(...segs);
    }
  }
  return out.join('\n');
}

/**
 * 表格行 MDX 安全化（normalizeMathFences 的 ② 分支实现）。
 *
 * 逐字符扫描一行 markdown 表格行：
 * - 非转义单个 `$…$` 成对且内容合理 → 剥掉两个 `$`，内容原样输出（LaTeX 字面，
 *   无 $ 噪音）。表格内 math 节点不激活（micromark 局限），保留 `$` 无益且显脏；
 * - 连续 `$$`：`$` 本身在文本层无害（不触发 MDX 语法），直接保留；
 * - 裸 `{`/`}` → `\{`/`\}`（MDX 文本层原样输出花括号；裸 `{` 会被当作 JS/JSX
 *   表达式起始，acorn 解析 `{2a}` 抛 "Identifier directly after number" → 整篇
 *   evaluate 失败 → /render 500，即生产日志 api/doc/nodes/render 50:103）；
 * - 已转义序列（`\X`）原样保留（含 `\$`、`\|`、`\{` 等）。
 */
function tableLineToSafe(t: string): string {
  let out = '';
  const flushLiteral = (ch: string): void => {
    // 裸 `{`/`}` 会被 MDX 当作 JS/JSX 表达式起始 → `\{`/`\}` 原样输出
    // 裸 `<`（如数学文本 `\alpha<1`）会被 MDX 当作 JSX 标签起始（`<1`）→ `\<` 原样输出
    if (ch === '{' || ch === '}' || ch === '<') out += `\\${ch}`;
    else out += ch;
  };
  for (let i = 0; i < t.length; ) {
    const ch = t[i];
    if (ch === '\\' && i + 1 < t.length) {
      out += ch + t[i + 1]; // 已转义序列保持
      i += 2;
      continue;
    }
    if (ch === '$' && t[i + 1] === '$') {
      out += '$$';
      i += 2;
      continue;
    }
    if (ch === '$') {
      // 保留 $（让 rehype-table-math 插件在 rehype 阶段二次渲染 cell 内公式）——
      // 此前剥 $ 是因为 cell 内 math 不激活、$ 仅是噪音；现在 rehypeTableMath 接管
      // 渲染必须保留 $ 作为 katex 激活标记。`{}`/`<` 已转义不触发 MDX expression/JSX ，
      // 故保留 $ 不会引入 acorn 崩溃。
      // 找同行闭合 `$`（跳过转义）只为更新 lastIndex，不改变字符
      let j = i + 1;
      while (j < t.length) {
        if (t[j] === '\\' && t[j + 1] === '$') { j += 2; continue; }
        if (t[j] === '$') break;
        j += 1;
      }
      out += '$';
      i += 1;
      continue;
    }
    flushLiteral(ch);
    i += 1;
  }
  return out;
}

/**
 * 纯 Markdown → HTML（轻量管线，无 JSX 组件）
 *
 * 用于日记悬浮预览等"只需渲染成 HTML"的场景，比 evaluate 轻量得多。
 * 输出为完整 HTML 文档片段（含 h1-h6 / p / ul / code 等标签）。
 */
export async function renderMarkdownHtml(source: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(source);
  return String(file);
}

/** 渲染结果 */
export interface RenderedMdx {
  /** 渲染后的 HTML（供 set:html / 预览使用） */
  html: string;
  /** 文章目录（h2/h3） */
  toc: TocItem[];
  /** 块级锚点映射（para-N → 块信息；思维导图片段引用用） */
  blockMap: BlockAnchorMap;
}

/**
 * 提取目录（独立轻量管线：remark → rehype → slug → katex → tocCollector）
 *
 * 与主渲染管线同构地跑 remarkMath/rehypeKatex：
 * 标题里的 `$...$` 会被渲染成 KaTeX HTML，collector 由此产出
 * `html` 字段（富文本目录用）与 `text` 字段（LaTeX 源码纯文本）。
 *
 * @param source MDX 源码
 * @returns 目录项数组
 */
export async function extractToc(source: string): Promise<TocItem[]> {
  const normalized = normalizeBackticks(source);
  const file = (await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeKatex)
    .use(rehypeTocCollector)
    .use(rehypeStringify)
    .process(normalized)) as unknown as { data: Record<string, unknown> };
  return (file.data.toc as TocItem[] | undefined) ?? [];
}

/** 递归提取元素文本（跳过 autolink 锚点子节点） */
function elementText(node: { type: string; tagName?: string; value?: unknown; children?: unknown[] }): string {
  if (node.type === 'text') return String(node.value ?? '');
  if (node.type === 'element' && node.tagName === 'a') return '';
  if (Array.isArray(node.children)) {
    return node.children
      .map((c) => elementText(c as { type: string; tagName?: string; value?: unknown; children?: unknown[] }))
      .join('');
  }
  return '';
}

/**
 * 从渲染后的 HTML 收集块级锚点映射（para-N → 块信息）。
 *
 * 与 evaluate 共用同一份 HTML（rehypePlugins 已含 rehypeBlockAnchors），
 * 保证映射与页面实际元素 100% 一致（不依赖独立管线的插件差异）。
 */
export function collectBlockMapFromHtml(html: string): BlockAnchorMap {
  const tree = unified().use(rehypeParse, { fragment: true }).parse(html) as unknown as {
    type: string;
    tagName?: string;
    properties?: Record<string, unknown>;
    children?: unknown[];
  };
  const map: BlockAnchorMap = {};
  const walk = (node: { type: string; tagName?: string; properties?: Record<string, unknown>; children?: unknown[] }): void => {
    if (node.type === 'element') {
      const id = node.properties?.id;
      if (typeof id === 'string' && id.startsWith('para-')) {
        const item: BlockAnchorItem = { type: node.tagName ?? '', text: elementText(node).trim().slice(0, 60) };
        map[id] = item;
      }
      if (Array.isArray(node.children)) node.children.forEach((c) => walk(c as typeof node));
    } else if (Array.isArray(node.children)) {
      node.children.forEach((c) => walk(c as typeof node));
    }
  };
  walk(tree);
  return map;
}

/**
 * 渲染 MDX 源码为 HTML（服务端）
 *
 * - 通过 `evaluate` 以 react/jsx-runtime 编译，配合 `useMDXComponents` 使用组件注册表；
 * - 结果经 `renderToString` 转为 HTML 字符串，可与自定义组件映射合并；
 * - 同时返回块级锚点映射（思维导图片段引用定位用）。
 *
 * @param source MDX 源码
 * @param options 渲染选项
 * @returns { html, toc, blockMap }
 */
export async function renderMdx(source: string, options: RenderOptions = {}): Promise<RenderedMdx> {
  const merged: MDXComponentMap = { ...mdxComponents, ...(options.components ?? {}) };
  // 反引号变体规范化：全角/修饰符变体 → ASCII，修复行内代码渲染失败
  // 数学 fence 规整：内容与 $$ 同行 → 拆为独占行（remark-math fence 语法要求），
  // 修复「编辑正常、阅读红字」（KaTeX 收到含 $$ 的非法 TeX → .katex-error）
  const normalized = normalizeMathFences(normalizeBackticks(source));

  // 仅缓存默认组件映射场景；自定义 components 会改变渲染结果
  if (!options.components) {
    const key = djb2(normalized);
    const hit = cacheGet(key);
    if (hit) return hit;
  }

  const { default: Content } = await evaluate(normalized, {
    jsx,
    jsxs,
    Fragment,
    remarkPlugins,
    rehypePlugins,
    development: false,
    useMDXComponents: (provided: MDXComponentMap | undefined) => ({
      ...mdxComponents,
      ...(provided ?? {}),
    }),
  } as Parameters<typeof evaluate>[1]);

  const html = renderToString(createElement(Content as ComponentType<{ components?: MDXComponentMap }>, { components: merged }));
  const toc = await extractToc(normalized);
  const blockMap = collectBlockMapFromHtml(html);

  const result: RenderedMdx = { html, toc, blockMap };
  if (!options.components) {
    cacheSet(djb2(normalized), result);
  }
  return result;
}

export { mdxComponents };
