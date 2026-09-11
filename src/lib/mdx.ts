/**
 * MDX 服务端渲染引擎（evaluate 模式）
 *
 * <!-- 区域划分 -->
 * - Imports: React / react-dom/server / react/jsx-runtime / @mdx-js/mdx / unified 管线 / 注册表 / 插件
 * - Toc: extractToc（独立轻量管线提取目录，避免依赖 evaluate 中间数据）
 * - Render: renderMdx（evaluate → renderToString）
 */
import { createHash } from 'node:crypto';
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
import { remarkFixGfmAutolink, remarkPlugins, rehypePlugins, rehypeTocCollector, type TocItem, type BlockAnchorMap, type BlockAnchorItem } from './mdx-plugins';
import { mdxComponents, type MDXComponentMap } from '@/components/mdx/registry';

/** 渲染选项 */
export interface RenderOptions {
  /** 额外覆盖的组件映射（与默认注册表合并） */
  components?: MDXComponentMap;
}

/* ============== renderMdx 内存 LRU 缓存 ==============
 * 切换同一篇文章第二次起几乎零延迟；高频访问受益显著。
 * - key 用归一化源码的 SHA-1 前 32 位十六进制（128 bit），避免 Map 直接持有大字符串作 key
 *   （原先的 djb2 仅 32 bit，理论上两字符即可碰撞；长文档在百条缓存下概率约 2.3e-6）
 * - 关键约束：写入与失效必须走**同一套** key 计算，即 normalizeSource() + cacheKey()。
 *   早期版本失效用 djb2(raw source)、写入用 djb2(normalized)，两者永不相等 → 失效彻底 no-op。
 * - 容量 100 条；Map 按插入顺序，超限驱逐最旧
 * - 仅在无自定义 components 时生效（自定义组件会改变渲染结果）
 * - 单 Vercel Function 实例；冷启动清空
 * ======================================================= */
const RENDER_CACHE_MAX = 100;
const RENDER_CACHE = new Map<string, RenderedMdx>();

/**
 * 计算缓存 key
 *
 * 用 SHA-1 前 16 字节（hex 32 字符 = 128 bit）。此处仅用于缓存寻址、不涉及安全，
 * 取 SHA-1 是因为它比 djb2 碰撞概率低若干个数量级，且比完整存储源码省内存。
 */
function cacheKey(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 32);
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

/**
 * 显式失效某源码的渲染缓存（文档更新时由调用方触发）
 *
 * 传入**原始源码**即可：内部会跑一遍与 renderMdx 完全相同的 normalizeSource()，
 * 保证这里的 key 与写入时的 key 一致（否则失效是 no-op）。
 */
export function invalidateRenderCache(source: string): void {
  RENDER_CACHE.delete(cacheKey(normalizeSource(source)));
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
    // 引用前缀剥离开销：拆分行内 `$$` 时逐段回添 `>` 前缀，
    // 否则 fence 行会逃出 blockquote，产生「未闭合引用 + 引用内 $…$ 被拒」双重报错。
    const { prefix, content } = splitQuotePrefix(t);
    // ② 表格数据行（顶格/≤3 缩进 + 行首 `|`）：remark-math 的 `$…$` 在 GFM 表格
    //    cell 内不激活 → 剥掉 `$` 以干净字面 LaTeX 显示，并把裸 `{`/`}` 转义为
    //    `\{`/`\}`（MDX 文本原样输出），阻止表达式解析崩溃（见 tableLineToSafe）。
    //    ⚠️ 勿加「缩进 ≥4 空格行跳过」分支：列表/引用内常有缩进 display 数学
    //    （如 `  $$ … $$`），跳过会破坏其拆分（曾在生产文档引发 acorn 崩溃回归）。
    if (/^\s{0,3}\|/.test(content)) {
      out.push(prefix + tableLineToSafe(content));
      continue;
    }
    // ① 非表格行：拆分行内所有非转义 `$$` 为独立行（每段一行，保持内容原样）
    //    拆行前先把裸 `<` 安全化（escapeBareLt）：`<0`/`<!`/`<=` 这类形态会让
    //    MDX JSX 解析器直接抛错、整篇 evaluate 失败（详见 escapeBareLt 注释）。
    // `segs[i].isMath` 标记该段是否**处于 display 数学内**（两个 `$$` 之间的内容）。
    // 拆行后段的 `$` 已消失，必须留下此标记：数学段内的花括号要原样保留给 KaTeX，
    // 非数学段的花括号才需转义（否则 acorn 崩）。丢掉该信息就会把
    // `\frac{n}{2}` 转义成 `\frac\{n\}\{2\}`，KaTeX 输出字面 `{n}{2}`（实测回归）。
    const segs: Array<{ text: string; isMath: boolean }> = [];
    let sawFence = false;
    let inMath = false; // 是否已进入 display 数学（`$$` 成对翻转）
    let buf = '';
    for (let i = 0; i < content.length; ) {
      if (content[i] === '\\' && content[i + 1] === '$') {
        buf += '\\$';
        i += 2;
        continue;
      }
      if (content[i] === '$' && content[i + 1] === '$') {
        // 进入/离开数学区前，先把已攒的文本段落盘（标记其所属区域）
        if (buf.trim() !== '') segs.push({ text: buf.replace(/^[ \t]+/, '').trimEnd(), isMath: inMath });
        segs.push({ text: '$$', isMath: false });
        sawFence = true;
        inMath = !inMath;
        buf = '';
        i += 2;
        continue;
      }
      buf += content[i];
      i += 1;
    }
    if (buf.trim() !== '') segs.push({ text: buf.replace(/^[ \t]+/, '').trimEnd(), isMath: inMath });
    // 行内没有 `$$` → **整行原样输出**（含缩进/尾空格），仅对裸 `<` 做安全化。
    // ⚠️ 判定必须用 sawFence 而非 `segs.length === 0`：无 `$$` 时 buf 也会攒出一个
    //    分段（segs.length === 1），若走 else 分支会把前导缩进 `/^\s+/` 剥掉 ——
    //    这会破坏 markdown 结构（列表项续行段落退化为顶层段落，
    //    `:::collapse` 内「恰好一个列表」校验失败 → 整个折叠面板静默消失）。
    if (!sawFence) {
      out.push(escapeBareBraces(escapeBareLt(t)));
    } else if (segs.length === 1 && segs[0]?.text === '$$' && /^\s*\$\$\s*$/.test(content)) {
      out.push(t); // 已是标准独立 fence 行：保持原样（含缩进/尾空格）
    } else {
      // 每段回添引用前缀（`$$` 段与文本段都要带，保持在同一 blockquote 内）。
      // ⚠️ 数学段（isMath）只做 `<` 安全化、**不转义花括号** —— 该段会成为
      //    display 数学内容，`\frac{n}{2}` 的 `{` 是 KaTeX 的参数边界；
      //    转义后 KaTeX 会输出字面 `{n}{2}`（实测回归）。
      //    非数学段（isMath=false）的花括号落在数学区外 → 必须转义，
      //    否则暴露给 MDX 表达式解析 → acorn「Could not parse expression」。
      for (const s of segs) {
        out.push(prefix + (s.isMath ? escapeBareLt(s.text) : escapeBareBraces(escapeBareLt(s.text))));
      }
    }
  }
  return out.join('\n');
}

/**
 * 剥出行首的引用块前缀（`>` 层级，可含空白），返回 `{ prefix, content }`。
 *
 * 用途：`normalizeMathFences` 拆行时必须逐段回添前缀 —— 否则 `> $$ … $$` 的
 * fence 行会跑到 blockquote 外，既造成「引用未闭合」，又让引用内的 `$…$`
 * 因 GFM 限制不激活（acorn 把 `{bmatrix}` 当 JS 表达式 → 整篇渲染 500）。
 *
 * 非引用行返回 `prefix = ''`。嵌套引用（`> > `）与带缩进的引用一并支持。
 */
function splitQuotePrefix(line: string): { prefix: string; content: string } {
  const m = /^((?:[ \t]{0,3}>[ \t]?)*)(.*)$/.exec(line);
  if (!m || !m[1]) return { prefix: '', content: line };
  return { prefix: m[1], content: m[2] ?? '' };
}

/**
 * 非表格行的裸 `<` 安全化（normalizeMathFences 的 ① 分支前置处理）。
 *
 * ## 背景（生产事故：2026-09-11 文档渲染 500）
 *
 * MDX 把 `<` 一律当 **JSX 标签起始**解析（micromark-extension-mdx-jsx）。当
 * `<` 后面紧跟的字符**不是**标签名合法起始字符时，解析器直接抛错：
 *
 *   Unexpected character `0` (U+0030) before name, expected a character
 *   that can start a name, such as a letter, `$`, or `_`
 *
 * 崩溃点：`micromark-extension-mdx-jsx/lib/factory-tag.js` 的 `nameBefore`。
 *
 * 典型触发源是**数学不等式写进普通正文**：`多余位 <0.5 舍去`、`a <0 b`、
 * 阶差 `< 25` 写成 `<25`、`<3` 之类。表格行早已由 `tableLineToSafe` 保护，
 * 但普通段落 / 列表 / 引用 / callout 内**完全没有防护** —— 于是同一句
 * 「`<0.5`」写在表格里正常、写在正文里整篇 500，且本地 SQLite 无关、
 * Obsidian 用 CommonMark 更不受影响，排查时极具迷惑性。
 *
 * ## 转义判据（保守白名单，勿放宽）
 *
 * 只保留这些**合法 JSX 起始形态**，其余 `<` 一律转义为 `\<`：
 * - `<` + `[A-Za-z_$]`  —— 开标签 / 自定义组件（`<Tex>`、`<_Foo>`）
 * - `</` + `[A-Za-z_$]` —— 闭合标签（`</Tex>`）
 * - `<>` / `</>`        —— fragment
 * - `<` + 空白 / 行尾   —— 非标签（本就不触发解析，但转义后渲染等价，顺手统一）
 *
 * 明确转义的崩溃形态：`<0`、`<1`、`<!`、`<=`、`<+`、`<.`、`<(`、`<` 等。
 * 其中 `<!--` 在 MDX 里必然崩（不支持 HTML 注释），转义后至少能正常显示文本。
 *
 * ## 为什么不用裸 `<` 全转义
 *
 * `\<` 经 micromark 的 character-escape 还原为字面 `<`，语义与显示均不变；
 * 但对**合法 JSX** 就完全不同了 —— 转义会让 `<Tex>` 变成可见文本 `<Tex>`，
 * 组件彻底失效。因此必须用白名单精确区分，不能一刀切。
 *
 * ## 边界
 *
 * - 已转义序列（`\<`）原样保留（幂等，重复调用不叠加反斜杠）；
 * - 行内代码（反引号）与围栏代码由调用方 `normalizeMathFences` 提前跳过
 *   （含反引号的行整体透传），本函数不重复判断；
 * - `$…$` 公式区内的 `<`（如 `$a < b$`）不受影响：公式走 math 节点，
 *   不经 JSX 解析；且成对 `$` 内的 `<` 后通常跟空格或字母，多被白名单放过。
 *   为实现简单与幂等，本函数不追踪 math 状态，仅按字符判据转义 —— 即便
 *   公式内出现 `<0` 被转义，KaTeX 也会把 `\<` 渲染为 `<`（LaTeX 中 `\<`
 *   是合法转义），视觉无差异。
 */
function escapeBareLt(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; ) {
    const ch = line[i];
    // 已转义的 `\<` 原样保留（幂等：不会二次加反斜杠）
    if (ch === '\\' && i + 1 < line.length) {
      out += ch + line[i + 1];
      i += 2;
      continue;
    }
    if (ch === '<') {
      const next = line[i + 1] ?? '';
      // 闭合标签 `</Name>` 与闭合 fragment `</>`：需看 `/` 之后的字符，
      // 否则会把 `</Tex>` 的 `/` 误判为裸字符而转义成 `<\</Tex>`（破坏标签）。
      if (next === '/') {
        const afterSlash = line[i + 2] ?? '';
        const isCloseTag = /[A-Za-z_$>]/.test(afterSlash);
        if (isCloseTag) {
          out += '</';
        } else {
          // `</` 后非法（如 `</ 0`）：整体转义 `<`，`/` 留在文本层无害
          out += '\\</';
        }
        i += 2;
        continue;
      }
      // 合法标签起始白名单：字母 / _ / $（开标签）、`>`（fragment `<>`）
      const isTagStart = /[A-Za-z_$>]/.test(next);
      // `<` 后跟空白或行尾：非标签，保留
      const isNonTag = next === '' || next === ' ' || next === '\t';
      if (isTagStart || isNonTag) {
        out += ch;
      } else {
        // 裸 `<` 会让 MDX JSX 解析器崩溃：转义为字面 `<`
        out += '\\<';
      }
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 数学区外裸花括号安全化（normalizeMathFences 非表格分支的前置处理）。
 *
 * ## 背景（生产事故：2026-09-11 文档渲染 500 · acorn）
 *
 * MDX 把裸 `{` 一律当 **JS 表达式起始**（micromark-extension-mdx-expression），
 * 交给 acorn 解析。当花括号内不是合法 JS 时，evaluate 直接抛：
 *
 *   Could not parse expression with acorn
 *
 * 最小复现：`{.tip}`、`{ .tip }`、`{2a}` 全部崩（`{1}` / `{x}` 合法故通过）。
 *
 * 触发源是**源码层已编码、但拆行后哨兵脱落**的场景：`> $$…$$` 这类
 * 引用块内的 display 数学，被 `normalizeMathFences` 拆成独占行后，
 * 行内 `$` 消失（fence 语义改由 `$$` 行承载），于是 `\frac{n}{2}` 的
 * 花括号落在「数学区外」→ 暴露给 MDX 表达式解析 → 整篇 500。
 *
 * 现状与此前 `escapeBareLt` 的缺口同构：**表格行有 `tableLineToSafe` 保护，
 * 非表格行只保护了 `<`，没保护 `{`** —— 这是本次事故的直接原因。
 *
 * ## 判据
 *
 * 只把「**不在行内 `$…$` 内**」的裸 `{` / `}` 转义为 `\{` / `\}`：
 * - `\{` 经 micromark character-escape 还原为字面 `{`，显示不变；
 * - `$…$` 内的花括号**必须原样保留** —— KaTeX 靠 `{…}` 作分式/上标参数边界，
 *   转义会把 `\frac{1}{2}` 渲染成字面 `{1}{2}`（表格分支早已踩过同一坑）；
 * - `$$` 连续双美元：`$` 在文本层无害，跳过并保持数学状态不翻转
 *   （首个 `$` 与第二个 `$` 相互抵消，避免 `$$` 被误判为「开/闭」而翻转状态）；
 * - 已转义序列 `\X` 原样保留（幂等，重复调用不叠加反斜杠）。
 *
 * ## 为什么不在源码层直接全量编码
 *
 * `encodeMarkSyntax` 已在源码层用 `SENT2` 保护花括号，但那只覆盖
 * **`==…=={…}` 后缀**这一种形态；正文数学里的 `{` 依赖行内 `$…$`
 * 天然隔离。一旦管道中途改变了 `$` 的分布（如这里的 `$$` 拆行），
 * 隔离就失效。因此必须在**管线末端、evaluate 之前**补一道兜底。
 */
function escapeBareBraces(line: string): string {
  let out = '';
  let inMath = false;
  for (let i = 0; i < line.length; ) {
    const ch = line[i];
    // 已转义序列（含 `\{` / `\}` / `\$`）原样保留 —— 幂等
    if (ch === '\\' && i + 1 < line.length) {
      out += ch + line[i + 1];
      i += 2;
      continue;
    }
    // `$$`：两侧 `$` 相互抵消，不翻转数学状态
    if (ch === '$' && line[i + 1] === '$') {
      out += '$$';
      i += 2;
      continue;
    }
    // 单个 `$`：切换行内数学状态
    if (ch === '$') {
      inMath = !inMath;
      out += ch;
      i += 1;
      continue;
    }
    if (!inMath && (ch === '{' || ch === '}')) {
      // 数学区外的裸花括号 → 转义为字面（否则 acorn 崩）
      out += '\\' + ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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
  // 表格行按 `$…$` 段切换 inMath 状态处理：
  // - inMath=true（公式段内）：字符原样保留——KaTeX 需要裸 `{`/`}` 作分式参数边界，
  //   若转义成 `\{`/`\}` 会把 \dfrac{1}{x} 渲染成字面 {1}/{1}（此前用户报告的现象）；
  //   公式段内的 `|`（如 \left| x \right| 的绝对值竖线）必须替换为 `\vert`——
  //   GFM 会把未转义 `|` 当列分隔符把公式切碎导致 math 无法激活；`\vert` 无 `|`
  //   字符，gfm 不切 cell，KaTeX 输出同一竖线且 \left\vert…\right\vert 渲染绝对值。
  // - inMath=false（公式段外：表头/备注/普通文本）：裸 `{`/`}`/`<` 转义
  //   （防 MDX expression/JSX 解析崩 → acorn 500）。
  // - `\` 引导的字符：原样保留（GFM 表格 cell 内 `$…$` 经 remark-math 激活为
  //   inlineMath 节点，value 由 micromark math tokenizer 收集，不经 character-escape，
  //   LaTeX 命令得以原样传给 KaTeX）。
  let out = '';
  let inMath = false;
  for (let i = 0; i < t.length; ) {
    const ch = t[i];
    if (ch === '\\' && i + 1 < t.length) {
      out += ch + t[i + 1]; // 已转义序列保持（\$ \| \{ \} 等）
      i += 2;
      continue;
    }
    if (ch === '$' && t[i + 1] === '$') {
      out += '$$';
      i += 2;
      continue;
    }
    if (ch === '$') {
      inMath = !inMath;
      out += '$';
      i += 1;
      continue;
    }
    if (inMath) {
      // `|` → `\vert ` 必须带尾随空格：KaTeX 控制词按最长字母序列匹配，
      // 无空格拼接会把后续字母吞进控制词（`$|A|$` → `\vertA` 未定义控制词 → 红字报错）；
      // 控制词后的空格被 KaTeX 词法消费，不产生可见空隙。
      out += ch === '|' ? '\\vert ' : ch;
      i += 1;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '<') {
      out += `\\${ch}`;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 荧光高亮语法：源码层哨兵协议（**必须在 MDX 解析之前执行**）
 *
 * ## 为什么需要源码层预处理（多次实测后的定版结论）
 *
 * MDX 的解析发生在 **remark 插件链之前**（@mdx-js/mdx 先跑 micromark 扩展建树，
 * 再把树交给 remark 插件）。这带来两个无法在插件内解决的问题：
 *
 * 1. **裸 `{` 崩 acorn**：`==文本=={.tip}` 的 `{.tip}` 被
 *    micromark-extension-mdx-expression 当 JS 表达式 → acorn 抛
 *    「Could not parse expression with acorn」→ 整篇 evaluate 500。
 * 2. **反斜杠转义在插件前就被吃掉**：`\=\=` / `\{` 经 micromark 的
 *    character-escape 还原为 `==` / `{` **之后**才轮到 remark 插件——
 *    插件看到的文本里已经没有任何「这是转义」的痕迹，无法区分
 *    「作者想写字面 `==`」与「作者想用高亮」。
 *
 * ## 协议（实测有效的唯一形态）
 *
 * 私有区字符 SENT（`\uE000`）作哨兵，且在源码层**完全替换掉花括号**——
 * 实测：只在 `{` 前后加哨兵**不能**阻止 acorn（`{` 依然裸露）；必须让 `{`/`}`
 * 彻底消失，`{.tip}` 整体降级为 `SENT.tipSENT` 这种纯文本形态。
 *
 * | 源码写法           | 替换为        | remark 阶段的含义      |
 * | ------------------ | ------------- | ---------------------- |
 * | `\=\=`（想写字面） | `SENT=SENT=`  | 字面 `==`，不触发高亮  |
 * | `==x=={.tip}`      | `==x==SENT.tipSENT` | 后缀修饰符        |
 * | `==tip:x==`        | `SENT=SENT=tipSENTx==` | 前缀修饰符     |
 *
 * 哨兵不参与任何 markdown 语法，能原样穿过 micromark 到达 remark 插件；
 * 插件据此精确区分「真定界符 / 字面量 / 后缀」，处理完把哨兵还原掉。
 *
 * ⚠️ 两个字符必须编码，各有独立的破坏源：
 * 1. **`=`**：`==tip` 里的第二个 `=` 紧贴字母，MDX 的 mdx-expression tokenizer
 *    会把 `=tip` 当表达式起点 → 残骸 `==<!-- -->tip<div></div>`。
 * 2. **`:`**：`tip:正文` 里的冒号会被 **remark-directive** 当 textDirective 开头
 *    （`:::note` 指令语法的基础）→ 文本被切成 `text("tip")` +
 *    `textDirective(name="正文==")`，高亮彻底失效。
 *    因此前缀写法的冒号也替换为哨兵。
 */
const SENT = '\uE000';

/**
 * 第二哨兵：**受保护的花括号**。
 *
 * MDX 把裸 `{…}` 当 JS 表达式解析（acorn），源码里任何字面花括号都必须先藏起来。
 * 但「非法后缀」`{.notavariant}` 又必须**原样保留**给用户看，不能被吞掉，
 * 因此用独立哨兵编码花括号本身，插件层不消费它、只在最终还原为 `{` / `}`。
 */
const SENT2 = '\uE001';

/** 源码层：把「紧跟 `==…==` 的 `{…}`」标记为后缀 */
// ⚠️ 正文部分**不能**再用 `[^=\n]*`：高亮文本里出现 `=` 是常态
//    （例：`==$|A| = 0$=={.tip}`、`==x == y=={.tip}`），旧写法会让整条
//    后缀失配 → `{` 裸露 → MDX 表达式解析 → acorn「Unexpected token」
//    → 整篇 evaluate 失败（/render 500 或编辑页红字）。
// 现写法要点：
//   - 左边界 `(?<!=)` + 起始 `==(?!=)`：排除 `===` 三连等号，避免吃掉字面量；
//   - 正文 `(?:(?!==)[^\n])*?` 非贪婪 + 内部禁止出现 `==`：在**第一个**可闭合的
//     `==` 处收边（跨 `==` 贪婪会把 `==a=={.tip} 与 ==b==` 并成一体）；
//   - `$…$` 内的 `=` 因此在正文范围内，后缀能正常匹配。
const SOURCE_MARK_SUFFIX_RE = /(?<!=)(==(?:(?!==)[^\n])*?==)\{([^}\n]*)\}/g;

/**
 * 源码层：前缀写法 `==variant:正文==` → 开标记编码。
 * 变体名限定为标识符字符，且必须在白名单内，避免误伤
 * `==注意：这里是重点==` 这类正文含全角冒号的场景（全角 `：` 不匹配）。
 */
const SOURCE_MARK_PREFIX_RE = /==([A-Za-z][\w-]*):/g;

/** 内置变体 + 别名白名单（须与 mdx-plugins.ts 的 MARK_VARIANT_ALIASES 保持一致） */
const MARK_VARIANT_NAMES = new Set([
  'primary', 'main', 'default',
  'secondary', 'sub',
  'tertiary', 'third',
  'error', 'danger', 'warning', 'warn', 'caution',
  'tip', 'success', 'info', 'note', 'hint',
]);

/**
 * 源码层预处理：转义字面量 + 编码后缀/前缀修饰符。
 *
 * ⚠️ **必须跳过代码区域**：围栏代码块（``` / ~~~）与行内代码（`…`）里的内容
 * 一律原样保留——用户在那里写的 `==x=={.tip}` 是**讲解示例**，不该被编码，
 * 否则解码后哨兵残留在 `<code>` 里，且花括号会被 MDX 当表达式（acorn 崩）。
 *
 * 处理顺序敏感：
 * 1. 先在「非代码区域」内做字面量/后缀/前缀编码
 * 2. 花括号兜底：非代码区域内所有剩余 `{` `}` 用 SENT2 保护，
 *    避免被 MDX 表达式解析器吃成 JS
 */
export function encodeMarkSyntax(source: string): string {
  return mapOutsideCode(source, (chunk) =>
    chunk
      // ① `\=\=` → 字面量哨兵形态
      .replace(/\\=\\=/g, `${SENT}=${SENT}=`)
      // ② 后缀修饰符 `==…=={…}`：合法变体 → 哨兵编码（供插件消费）；
      //    非法名 → 花括号用 SENT2 保护（原样还原为 `{.notavariant}`，
      //    既不静默吞掉用户内容，也不让裸花括号触发 MDX 表达式解析）
      .replace(SOURCE_MARK_SUFFIX_RE, (m, mark: string, inner: string) =>
        MARK_VARIANT_NAMES.has(inner.replace(/^\./, '').trim().toLowerCase())
          ? `${mark}${SENT}${inner}${SENT}`
          : `${mark}${SENT2}L${inner}${SENT2}R`,
      )
      // ③ 前缀开标记：`==tip:` → `SENT=SENT=tipSENT`（冒号也换成哨兵，
      //    否则被 remark-directive 当 textDirective 解析）
      .replace(SOURCE_MARK_PREFIX_RE, (m, name: string) =>
        MARK_VARIANT_NAMES.has(name.toLowerCase()) ? `${SENT}=${SENT}=${name}${SENT}` : m,
      ),
  );
}

/**
 * 源码层：把 `:::collapse` 容器的**空格参数**改写为 remark-directive 认得的**花括号属性**。
 *
 * ## 为什么必须做这一步
 *
 * 语法设计对齐 VuePress Plume 主题，参数写在容器名之后、以空格分隔：
 *
 *   :::collapse accordion
 *   :::collapse expand
 *   :::collapse accordion expand
 *
 * 但 `remark-directive` **只认花括号属性语法**（`:::collapse{accordion}`），
 * 空格形式会被它整个丢弃 —— 实测 `:::collapse accordion` 被解析成
 * **普通段落**（type=paragraph），容器与列表全部失效。
 *
 * 因此在 MDX 解析前把空格参数改写为花括号属性，插件层就能拿到
 * `node.attributes = { accordion: '', expand: '' }`。
 *
 * ## 边界
 *
 * - 只改写 `:::` 开标记行（行首、前导空格 ≤3），`:::` 闭合行与普通文本不受影响；
 * - 仅在「非代码区域」生效（与荧光高亮同一约束），围栏代码块里的示例写法原样保留；
 * - 参数白名单限定 `accordion` / `expand`，未知词原样留着（不静默吞用户内容）；
 * - 已经写了花括号属性的不动（幂等）。
 */
export function normalizeCollapseParams(source: string): string {
  return mapOutsideCode(source, (chunk) =>
    // 只匹配「行首 + :::collapse + 空格参数 + 行尾」，闭合的 `:::` 与行内提及不受影响
    chunk.replace(
      /^([ \t]{0,3}:{3,}[ \t]*collapse)[ \t]+((?:[A-Za-z][\w-]*[ \t]*)+)$/gm,
      (full, head: string, params: string) => {
        const names = params.trim().split(/[ \t]+/).filter(Boolean);
        // 全部参数都需在白名单内才改写；含未知词则原样保留（降级为普通文本，不破坏原文）
        if (names.length === 0) return full;
        if (!names.every((n) => COLLAPSE_PARAM_NAMES.has(n.toLowerCase()))) return full;
        return `${head}{${names.join(' ')}}`;
      },
    ),
  );
}

/** `:::collapse` 允许的参数名白名单 */
const COLLAPSE_PARAM_NAMES = new Set(['accordion', 'expand']);

/** 折叠面板初始状态标记的哨兵（私有区字符，正文不会自然出现） */
const COLLAPSE_MARK_SENT = '\uE002';

/**
 * 源码层：把折叠面板列表项的 `:+` / `:-` 初始状态标记编码为哨兵。
 *
 * ## 为什么必须编码（与 `==tip:` 前缀被吃掉是同一类坑）
 *
 * `:` 是 **remark-directive** 的指令起始字符。实测 `- :+ 标题` 被解析为
 * `textDirective(name="+")` + `text(" 标题")` —— 标记字符在插件层已经
 * 不再是文本，既无法用文本匹配识别，还会渲染出一个空的 `<div></div>`。
 *
 * 因此在 MDX 解析前把 `+` / `-` 换成哨兵，穿过 micromark 后由
 * `remarkCollapse` 精确还原。哨兵只替换标记字符本身，`:` 一并吃掉
 * （留着仍是 textDirective 起点）。
 *
 * 形态：`:+` → `SENT_P`，`:-` → `SENT_M`；插件还原为 `+` / `-`。
 */
export function encodeCollapseMarkers(source: string): string {
  return mapOutsideCode(source, (chunk) =>
    // 只匹配「列表项行首 + :+/:- + 空白 + 内容」，避免误伤正文里的 `:+`（如时间 `12:+3`）
    chunk.replace(/^([ \t]{0,3}[-*+][ \t]+):([+-])(?=[ \t])/gm, (_, head: string, sign: string) =>
      `${head}${COLLAPSE_MARK_SENT}${sign}`,
    ),
  );
}

/** 折叠面板标记哨兵（供 mdx-plugins 消费） */
export const COLLAPSE_MARK_SENTINEL = COLLAPSE_MARK_SENT;

/** 选项卡组分区分隔哨兵（`@tab` 改写为列表项时的标签前缀） */
export const TABS_MARK_SENTINEL = '\uE003';

/** 选项卡组标签行的二级分隔符（哨兵之后的字段分隔） */
export const TABS_FIELD_SEP = '\uE004';

/**
 * 源码层：把 `:::tabs#id` + `@tab` 分区语法改写为 remark-directive 能解析的形态。
 *
 * ## 源语法（对齐 VuePress Plume 主题的 tabs 容器）
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
 * ## 为什么必须改写（三重障碍，与 `:::collapse` 同源）
 *
 * 1. `:::tabs#package-manager` —— remark-directive 的容器名不允许 `#`，
 *    整个开标记行被降级为**普通段落**，容器失效；
 * 2. `@tab` 不是任何标准语法，需要自建分隔语义；
 * 3. `@tab:active` 里的 `:` 会被 remark-directive 吃成 `textDirective`，
 *    既无法文本匹配、又会渲染出空 `<div>`。
 *
 * 且 remark-directive **不支持嵌套容器**（实测内层 `:::tab` 不会被解析）。
 *
 * ## 改写策略
 *
 * 把「容器 + 若干 `@tab` 分区」改写为「**容器 + 一个无序列表**」：
 * 每个 `@tab` 变成列表项 `- <哨兵>标签行`，其后内容整体缩进 2 空格成为该项正文。
 * 插件层 `remarkTabs` 只需处理「容器内恰好一个列表」这一种形态，
 * 与 `remarkCollapse` 完全同构。
 *
 * 容器标识改写为 `:::tabs{#id}`（remark-directive 的 `#id` 简写，
 * 解析结果落在 `attributes.id`）。
 *
 * 标签行编码（全部用哨兵避开 remark-directive 的字符冲突）：
 *
 *   @tab npm            → `- <S>label<npm`
 *   @tab:active pnpm    → `- <S>active<label<pnpm`
 *   @tab **pnpm**#pnpm  → 同上，但 `#锚点` 在插件层从标签尾部剥离
 *
 * 其中 `<S>` = `TABS_MARK_SENTINEL`，`<` = 二级分隔符 `TABS_FIELD_SEP`。
 *
 * ## 边界
 *
 * - 仅在「非代码区域」生效（围栏代码块里的示例原样保留）；
 * - 未闭合的 `:::tabs` 或没有任何 `@tab` 的行 → 原样保留（降级为普通 Markdown）；
 * - `:::tabs` 之外的 `@tab` 行不受影响（必须处于 tabs 容器内）。
 */
export function normalizeTabs(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 围栏代码块：整体透传（不做任何改写）
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1] ?? '';
      const ch = marker[0] ?? '`';
      out.push(line);
      i += 1;
      // P3-1：闭合围栏正则与行内容无关，提到循环外只编译一次（原先每行都 new RegExp）
      const closeFenceRe = new RegExp(`^ {0,3}\\${ch}{${marker.length},}\\s*$`);
      for (; i < lines.length; i += 1) {
        const l = lines[i] ?? '';
        out.push(l);
        if (closeFenceRe.test(l)) {
          i += 1;
          break;
        }
      }
      continue;
    }

    const open = /^([ \t]{0,3}):{3,}[ \t]*tabs(?:[ \t]*#([\w-]+)|[ \t]*\{[^}]*\})?[ \t]*$/.exec(line);
    if (!open) {
      out.push(line);
      i += 1;
      continue;
    }

    // 收集容器内容（直到 `:::` 闭合行）
    const indent = open[1] ?? '';
    const stableId = open[2] ?? '';
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j += 1) {
      if (/^[ \t]{0,3}:{3,}[ \t]*$/.test(lines[j] ?? '')) {
        closed = true;
        break;
      }
      body.push(lines[j] ?? '');
    }
    if (!closed) {
      // 未闭合：原样保留（保守，不破坏原文）
      out.push(line);
      i += 1;
      continue;
    }

    // 切成若干分区：每个 @tab 行开启一个分区
    type Section = { active: boolean; label: string; anchor: string; body: string[] };
    const sections: Section[] = [];
    let cur: Section | null = null;
    for (const bl of body) {
      // @tab 行：`@tab[:active] <标签>[#锚点]`
      const tab = /^[ \t]{0,3}@tab(:active)?[ \t]+(.+?)[ \t]*$/.exec(bl);
      if (tab) {
        const rawLabel = tab[2] ?? '';
        // 后缀 `#锚点`：从标签尾部剥离（标签本身可能含 `**加粗**` 等富文本）
        const anchorMatch = /#([\w-]+)[ \t]*$/.exec(rawLabel);
        let label = rawLabel;
        let anchor = '';
        if (anchorMatch) {
          anchor = anchorMatch[1] ?? '';
          label = rawLabel.slice(0, anchorMatch.index).trimEnd();
        }
        cur = { active: Boolean(tab[1]), label, anchor, body: [] };
        sections.push(cur);
        continue;
      }
      if (cur) cur.body.push(bl);
      // 分区之前的散落内容忽略（Plume 语义：@tab 之前的内容不属于任何分区）
    }

    // 少于 2 个分区 → 原样保留（降级为普通 Markdown）
    if (sections.length < 2) {
      out.push(line, ...body, lines[j] ?? '');
      i = j + 1;
      continue;
    }

    // 产出：:::tabs{#stableId} + 无序列表（每项 = 一个分区）
    // ⚠️ 必须用 `#id` 简写：remark-directive 的属性语法**不支持** `key="value"`，
    //    `:::tabs{stableId="pkg"}` 会让整个开标记行降级为普通段落（实测）。
    //    `{#pkg}` → `attributes.id = 'pkg'`，是 remark-directive 原生支持的写法。
    const attr = stableId ? `{#${stableId}}` : '';
    out.push(`${indent}:::tabs${attr}`);
    out.push('');
    for (const s of sections) {
      // 标签行编码（全部塞进首个文本节点，插件层一次解出）：
      //   <哨兵> + active 标记 + <分隔> + 锚点 + <分隔> + 标签原文
      // ⚠️ 锚点必须排在标签**前面**：标签可能含行内 Markdown（`**x**`），
      //    被 micromark 拆成多个节点后，落在首文本节点里的只有锚点段，
      //    标签正文则可能散在后续节点（甚至 strong/em 内部）——这是安全的，
      //    因为插件只需从首节点剥掉「哨兵+标记+锚点」前缀，余下原样保留。
      const meta = `${TABS_MARK_SENTINEL}${s.active ? 'active' : ''}${TABS_FIELD_SEP}${s.anchor}${TABS_FIELD_SEP}${s.label}`;
      out.push(`${indent}- ${meta}`);
      // 正文整体缩进 2 空格（列表项续行）；空行保留为空行
      const trimmed = trimBlankEdges(s.body);
      if (trimmed.length > 0) {
        out.push('');
        for (const bl of trimmed) out.push(bl.trim() === '' ? '' : `${indent}  ${bl}`);
      }
      out.push('');
    }
    out.push(`${indent}:::`);
    i = j + 1;
  }
  return out.join('\n');
}

/** 去掉数组首尾的空行 */
function trimBlankEdges(arr: string[]): string[] {
  let s = 0;
  let e = arr.length;
  while (s < e && (arr[s] ?? '').trim() === '') s += 1;
  while (e > s && (arr[e - 1] ?? '').trim() === '') e -= 1;
  return arr.slice(s, e);
}

/**
 * 对源码里**围栏代码块之外**的片段应用 `fn`，围栏块原样透传。
 *
 * 识别围栏代码块（与 Markdown 规范一致）：
 * 行首 0-3 空格 + ``` / ~~~（含 info string），直到同字符的闭合围栏；
 * 未闭合则延伸到文末（保守：宁可少转换也不破坏代码）。
 *
 * ⚠️ **行内代码不在此处切分**：`==请在 \`npm install\` 后重试=={.tip}` 这类写法里，
 * 行内代码位于高亮定界符**内部**，若按 `` ` `` 切段会导致 `==…=={.tip}` 被拆散、
 * 后缀编码失效。行内代码「不触发高亮」由 rehype 阶段的 `code` 屏障保证，不靠源码层。
 */
function mapOutsideCode(source: string, fn: (chunk: string) => string): string {
  let out = '';
  const lines = source.split('\n');

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li] ?? '';
    const nl = li < lines.length - 1 ? '\n' : '';

    // 围栏代码块起点：0-3 空格 + 至少 3 个 ` 或 ~
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1] ?? '';
      const ch = marker[0] ?? '`';
      out += line + nl;
      li += 1;
      // 找闭合围栏（同字符、长度不短于起始）
      let closed = false;
      // P3-1：闭合正则只依赖起始围栏，提到循环外编译一次
      const closeRe = new RegExp(`^ {0,3}\\${ch}{${marker.length},}\\s*$`);
      for (; li < lines.length; li += 1) {
        const l = lines[li] ?? '';
        const eol = li < lines.length - 1 ? '\n' : '';
        out += l + eol;
        if (closeRe.test(l)) {
          closed = true;
          break;
        }
      }
      if (!closed) break;
      continue;
    }

    out += fn(line) + nl;
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
    .use(remarkFixGfmAutolink)
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
    .use(remarkFixGfmAutolink)
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
 * HTML 片段解析器（P3-2）
 *
 * 原先每次调用都 `unified().use(rehypeParse, …)` 现造一个 processor，
 * 构造开销随每篇文档重复支付。parse 本身无状态，复用单例即可。
 */
const HTML_PARSER = unified().use(rehypeParse, { fragment: true });

/**
 * 从渲染后的 HTML 收集块级锚点映射（para-N → 块信息）。
 *
 * 与 evaluate 共用同一份 HTML（rehypePlugins 已含 rehypeBlockAnchors），
 * 保证映射与页面实际元素 100% 一致（不依赖独立管线的插件差异）。
 */
export function collectBlockMapFromHtml(html: string): BlockAnchorMap {
  const map: BlockAnchorMap = {};
  // P3-2 快路径：没有块级锚点时不必解析整棵 HTML 树（短文档 / 未启用段落锚点直接返回）
  if (!html.includes('id="para-')) return map;
  const tree = HTML_PARSER.parse(html) as unknown as {
    type: string;
    tagName?: string;
    properties?: Record<string, unknown>;
    children?: unknown[];
  };
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
 * 源码预处理的唯一入口
 *
 * 六层规范化，顺序不可调换（后者依赖前者的输出）：
 * 1. normalizeBackticks  反引号变体 → ASCII（U+0060），修复行内代码渲染失败
 * 2. normalizeMathFences 「内容与 $$ 同行」→ 拆为独占行，修复 KaTeX 收到非法 TeX 的红字
 * 3. normalizeCollapseParams `:::collapse accordion` → `:::collapse{accordion}`
 *    （remark-directive 只认花括号属性，空格参数会被整行降级为普通段落）
 * 4. normalizeTabs `:::tabs#id` + `@tab` → `:::tabs{stableId="id"}` + 无序列表
 *    （`#` 容器名不被识别、`@tab` 非标准、`:` 被吃成 textDirective，且不支持嵌套容器）
 * 5. encodeCollapseMarkers / 6. encodeMarkSyntax
 *    字面量 `\=\=` 与后缀 `{…}` 在 MDX 解析前打上私有区哨兵，
 *    防 acorn 表达式崩溃 + 让插件能区分「字面量 / 真定界符 / 后缀」
 *
 * **抽成单一函数的原因**：renderMdx 写缓存与 invalidateRenderCache 失效缓存
 * 必须基于同一份归一化结果，否则两侧 key 永不相等、失效变成 no-op。
 */
export function normalizeSource(source: string): string {
  return encodeMarkSyntax(
    encodeCollapseMarkers(
      normalizeTabs(normalizeCollapseParams(normalizeMathFences(normalizeBackticks(source)))),
    ),
  );
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
  // 预处理细节见 normalizeSource() 注释
  const normalized = normalizeSource(source);
  // 仅缓存默认组件映射场景；自定义 components 会改变渲染结果。
  // key 只算一次，查与写复用同一个，避免两次计算不一致导致缓存永不命中。
  const cacheable = !options.components;
  const key = cacheable ? cacheKey(normalized) : '';
  if (cacheable) {
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
  if (cacheable) {
    cacheSet(key, result);
  }
  return result;
}

export { mdxComponents };
