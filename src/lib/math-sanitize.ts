/**
 * math-sanitize.ts —— KaTeX 渲染选项与消毒白名单的**单一事实来源**
 *
 * 背景（P2-23 的收敛方案）：
 * 项目里有两条 Markdown 渲染管线，各自独立实现了「渲染数学 → 消毒 HTML」：
 *   1. 主渲染管线：`src/lib/mdx.ts` + `src/lib/mdx-plugins.ts`（@mdx-js/mdx，服务端，
 *      用于文章/文档正文，支持完整 MDX 语法与组件岛）；
 *   2. AI 助手：`src/components/ai/AiChatFloat.tsx`（marked + KaTeX + DOMPurify，
 *      浏览器端，用于流式回答的增量渲染）。
 *
 * 两条管线的**定位不同、无法合并**（AI 场景需要同步、轻量、可逐 token 重渲染），
 * 但「数学怎么渲染、哪些标签该放行」必须一致，否则会出现：
 *   - 一边公式正常、一边公式被 DOMPurify 吃掉（MathML 标签进了黑名单）；
 *   - 一边字体失败有 MathML 兜底、一边糊成一团。
 *
 * 因此把这两项抽到这里，两条管线共同引用，从根上消除漂移。
 */
import katex from 'katex';

/**
 * 统一的 KaTeX 渲染选项。
 * - `throwOnError: false`：单条公式语法错只让该段退化为源码，不让整页/整条回答崩掉；
 * - `output: 'htmlAndMathml'`：同时输出视觉层（.katex-html）与原生层（.katex-mathml）。
 *   后者由浏览器排版引擎直接渲染、不依赖任何 web 字体 —— 这是 BaseLayout 里
 *   KaTeX 字体韧性方案（加载失败切 .katex-font-fallback）能生效的前提。
 */
export const KATEX_RENDER_OPTIONS: Omit<katex.KatexOptions, 'displayMode'> = {
  throwOnError: false,
  output: 'htmlAndMathml',
} as const;

/**
 * DOMPurify 放行标签：KaTeX 的 htmlAndMathml 输出会带 MathML 元素与内联 SVG
 * （\sqrt 的根号、\overbrace 的花括号都是 SVG 画的）。
 * DOMPurify 默认不认识 MathML，会**静默删掉**它们 → 公式只剩半截。
 * 这份清单即为此而设；两边共用，避免「改了一处忘另一处」导致公式半残。
 */
export const KATEX_ALLOWED_TAGS: readonly string[] = [
  // MathML 结构
  'math',
  'semantics',
  'annotation',
  'mrow',
  'mi',
  'mo',
  'mn',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mtext',
  'mspace',
  'mstyle',
  'munder',
  'mover',
  'munderover',
  'mtable',
  'mtr',
  'mtd',
  'mpadded',
  'mphantom',
  'menclose',
  'mmultiscripts',
  'maction',
  // 内联 SVG（根号、花括号等）
  'svg',
  'path',
  'g',
  'use',
  'defs',
  'line',
  'rect',
  'circle',
  'ellipse',
  'polyline',
  'polygon',
] as const;
