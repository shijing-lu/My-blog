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
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { remarkPlugins, rehypePlugins, rehypeTocCollector, type TocItem } from './mdx-plugins';
import { mdxComponents, type MDXComponentMap } from '@/components/mdx/registry';

/** 渲染选项 */
export interface RenderOptions {
  /** 额外覆盖的组件映射（与默认注册表合并） */
  components?: MDXComponentMap;
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
}

/**
 * 提取目录（独立轻量管线：remark → rehype → slug → tocCollector）
 *
 * @param source MDX 源码
 * @returns 目录项数组
 */
export async function extractToc(source: string): Promise<TocItem[]> {
  const normalized = normalizeBackticks(source);
  const file = (await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeTocCollector)
    .use(rehypeStringify)
    .process(normalized)) as unknown as { data: Record<string, unknown> };
  return (file.data.toc as TocItem[] | undefined) ?? [];
}

/**
 * 渲染 MDX 源码为 HTML（服务端）
 *
 * - 通过 `evaluate` 以 react/jsx-runtime 编译，配合 `useMDXComponents` 使用组件注册表；
 * - 结果经 `renderToString` 转为 HTML 字符串，可与自定义组件映射合并。
 *
 * @param source MDX 源码
 * @param options 渲染选项
 * @returns { html, toc }
 */
export async function renderMdx(source: string, options: RenderOptions = {}): Promise<RenderedMdx> {
  const merged: MDXComponentMap = { ...mdxComponents, ...(options.components ?? {}) };
  // 反引号变体规范化：全角/修饰符变体 → ASCII，修复行内代码渲染失败
  const normalized = normalizeBackticks(source);

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

  return { html, toc };
}

export { mdxComponents };
