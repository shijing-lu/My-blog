/**
 * GET /api/doc/nodes/[id]/render —— 渲染文章节点（服务端 MDX → HTML，公开）
 */
import type { APIRoute } from 'astro';
import { getDocNode } from '@/lib/docs';
import { renderMdx } from '@/lib/mdx';
import { json } from '@/lib/api';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const node = await getDocNode(id);
  if (!node || node.kind !== 'article') return json({ error: '文章不存在' }, 404);
  try {
    const { html, toc } = await renderMdx(node.content);
    return json({ title: node.title, html, toc });
  } catch (err) {
    console.error('[api/doc/nodes/render]', err);
    return json({ error: '渲染失败' }, 500);
  }
};
