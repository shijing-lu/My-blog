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
import { remarkFixGfmAutolink, remarkPlugins, rehypePlugins, rehypeTocCollector, type TocItem, type BlockAnchorMap, type BlockAnchorItem } from './mdx-plugins';
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
const SOURCE_MARK_SUFFIX_RE = /(==[^=\n]*==)\{([^}\n]*)\}/g;

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
      for (; li < lines.length; li += 1) {
        const l = lines[li] ?? '';
        const eol = li < lines.length - 1 ? '\n' : '';
        out += l + eol;
        const closeRe = new RegExp(`^ {0,3}\\${ch}{${marker.length},}\\s*$`);
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
  // 荧光语法哨兵编码：字面量 `\=\=` 与后缀 `{…}` 在 MDX 解析前打上私有区哨兵，
  // 防 acorn 表达式崩溃 + 让插件能区分「字面量 / 真定界符 / 后缀」
  // 折叠面板参数改写：`:::collapse accordion` → `:::collapse{accordion}`
  // （remark-directive 只认花括号属性，空格参数会被整行降级为普通段落）
  const normalized = encodeMarkSyntax(
    encodeCollapseMarkers(normalizeCollapseParams(normalizeMathFences(normalizeBackticks(source)))),
  );

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
