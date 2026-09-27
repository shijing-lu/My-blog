/** 管理端首次发布文章；已发布文章保存即生效。 */
import type { APIRoute } from 'astro';
import { publishArticle } from '@/lib/articles';
import { json, missing, notFound } from '@/lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ params }) => {
  if (!params.id) return missing('id');
  try {
    const article = await publishArticle(params.id);
    if (!article) return notFound('文章不存在');
    return json({ published: article.published, slug: article.slug });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '发布失败' }, 400);
  }
};
