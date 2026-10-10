import type { APIRoute } from 'astro';
import { canManage } from '@/lib/admin-auth';
import { json } from '@/lib/api';
import { listArticleCategories } from '@/lib/article-categories';
import { getArticleById } from '@/lib/articles';
import { importArticleFile } from '@/lib/article-file-import';
import { MarkdownImportError, readMarkdownFile } from '@/lib/markdown-file-import';

export const prerender = false;
const reply = (data: unknown, status = 200): Response => json(data, { status, headers: { 'cache-control': 'private, no-store' } });
export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!await canManage(cookies, 'articles')) return reply({ error: '无文章管理权限' }, 403);
  const categoryId = url.searchParams.get('parentId') || null;
  if (categoryId && !(await listArticleCategories()).some(category => category.id === categoryId)) return reply({ error: '目标分类不存在' }, 400);
  try {
    const file = await readMarkdownFile(request, url);
    await importArticleFile(file, categoryId);
    const article = await getArticleById(file.id);
    if (!article) throw new Error('无法读取已导入文章');
    return reply({ node: { id: article.id, title: article.title, kind: 'article', parentId: categoryId,
      sort: article.createdAt.getTime(), createdAt: article.createdAt, updatedAt: article.updatedAt }, draft: true }, 201);
  } catch (error) {
    if (error instanceof MarkdownImportError) return reply({ error: error.message }, error.status);
    console.error('[api/articles/import]', error);
    return reply({ error: '导入失败，请重试' }, 500);
  }
};
