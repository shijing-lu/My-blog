/** 管理端创建空白草稿。 */
import type { APIRoute } from 'astro';
import { createArticleDraft } from '@/lib/articles';
import { json } from '@/lib/api';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const article = await createArticleDraft();
    return json({ id: article.id }, 201);
  } catch (error) {
    console.error('[api/articles] create draft', error);
    return json({ error: '创建草稿失败，请重试' }, 500);
  }
};
