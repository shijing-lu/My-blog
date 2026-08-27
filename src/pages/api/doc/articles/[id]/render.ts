/**
 * GET /api/doc/articles/[id]/render —— 文章渲染（公开）
 *
 * 服务端 renderMdx → { title, html, toc }，供文档详情页左栏"前端即时切换"使用
 * （点击左栏文章时 fetch 此接口，无需整页导航，避免转圈/不跳转问题）。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getDocArticle } from '@/lib/docs';
import { renderMdx } from '@/lib/mdx';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  try {
    const article = await getDocArticle(id);
    if (!article) return json({ error: '文章不存在' }, 404);
    const { html, toc } = await renderMdx(article.content);
    return json({ title: article.title, html, toc });
  } catch (err) {
    console.error('[api/doc/articles/render]', err);
    return json({ error: '渲染失败' }, 500);
  }
};
