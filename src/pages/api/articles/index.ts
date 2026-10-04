/** 显式的新建文章操作。GET 编辑入口不会创建文章。 */
import type { APIRoute } from 'astro';
import { createArticle, deleteArticle } from '@/lib/articles';
import { listArticleCategories, setArticleCategory } from '@/lib/article-categories';
import { badRequest, json, readJson } from '@/lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = request.headers.get('content-type')?.includes('application/json') ? await readJson<{ parentId?: string | null }>(request) : null;
    const parentId = body?.parentId || null;
    if (parentId && !(await listArticleCategories()).some(category => category.id === parentId)) return badRequest('目标目录不存在');
    const article = await createArticle();
    if (parentId && !(await setArticleCategory(article.id, parentId))) {
      await deleteArticle(article.id);
      throw new Error('无法将文章加入目标目录');
    }
    return json({ id: article.id }, 201);
  } catch (error) {
    console.error('[api/articles] create', error);
    return json({ error: '创建文章失败，请重试' }, 500);
  }
};
