/** 管理端文章预览：渲染未保存的 Markdown/MDX，不修改发布状态。 */
import type { APIRoute } from 'astro';
import { badJson, json, readJson } from '@/lib/api';
import { renderMdx } from '@/lib/mdx';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ source?: unknown }>(request);
  if (!body) return badJson();
  const source = typeof body.source === 'string' ? body.source : '';
  if (source.length > 500_000) return json({ error: '内容过长' }, 413);
  if (!source.trim()) return json({ html: '', toc: [] });
  try {
    const { html, toc } = await renderMdx(source);
    return json({ html, toc });
  } catch (error) {
    console.error('[api/articles/preview]', error);
    return json({ error: '预览渲染失败，请检查 Markdown 语法' }, 422);
  }
};
