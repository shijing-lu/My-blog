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
  const file = (await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeTocCollector)
    .use(rehypeStringify)
    .process(source)) as unknown as { data: Record<string, unknown> };
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

  const { default: Content } = await evaluate(source, {
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
  const toc = await extractToc(source);

  return { html, toc };
}

export { mdxComponents };
