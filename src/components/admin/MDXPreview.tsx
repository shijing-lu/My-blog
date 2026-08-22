/**
 * MDXPreview.tsx —— 浏览器端实时 MDX 预览
 *
 * - 对 content 做 300ms 防抖后，用 `@mdx-js/mdx` 的 `evaluate`（与渲染管线共用
 *   remark/rehype 插件 + 组件注册表）编译，再经 `renderToString` 输出 HTML；
 * - 语法错误展示错误卡片，不阻塞编辑器。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { evaluate } from '@mdx-js/mdx';
import { remarkPlugins, rehypePlugins } from '@/lib/mdx-plugins';
import { mdxComponents } from '@/components/mdx/registry';

/** 组件 Props */
interface MDXPreviewProps {
  /** 待渲染的 MDX 源码 */
  content: string;
}

/** 实时预览 */
export default function MDXPreview({ content }: MDXPreviewProps): ReactElement {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const mySeq = ++seqRef.current;
    debounceRef.current = window.setTimeout(async () => {
      setRendering(true);
      try {
        const { default: Content } = await evaluate(content, {
          jsx,
          jsxs,
          Fragment,
          remarkPlugins,
          rehypePlugins,
          development: false,
          baseUrl: document.baseURI,
          useMDXComponents: (provided: Record<string, unknown> | undefined) => ({
            ...mdxComponents,
            ...(provided ?? {}),
          }),
        } as Parameters<typeof evaluate>[1]);
        const out = renderToString(createElement(Content, { components: mdxComponents }));
        if (mySeq === seqRef.current) {
          setHtml(out);
          setError(null);
        }
      } catch (err) {
        if (mySeq === seqRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (mySeq === seqRef.current) setRendering(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [content]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="pixel-chip text-muted-foreground">PREVIEW</span>
        <span className={`pixel-chip ${rendering ? 'text-primary' : 'text-muted-foreground'}`}>
          {rendering ? '渲染中…' : error ? '错误' : '就绪'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </pre>
        ) : (
          <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
