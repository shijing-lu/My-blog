/** 管理端文章原位编辑结束后重建阅读 HTML 与右侧目录。 */
import type { APIRoute } from 'astro';
import { getArticleById } from '@/lib/articles';
import { guardManager, json, missing, notFound } from '@/lib/api';
import { renderMdx } from '@/lib/mdx';
import { getImageSizes, collectImageIdsFromHtml, injectImageSizeAttrs } from '@/lib/images';

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = params.id;
  if (!id) return missing('id');
  const article = await getArticleById(id);
  if (!article) return notFound('文章不存在');
  try {
    const rendered = await renderMdx(article.content);
    const ids = collectImageIdsFromHtml(rendered.html);
    const html = ids.length ? injectImageSizeAttrs(rendered.html, await getImageSizes(ids)) : rendered.html;
    return json({ title: article.title, html, toc: rendered.toc });
  } catch (error) {
    console.error('[api/articles/render]', error);
    return json({ error: '渲染失败' }, 500);
  }
};
