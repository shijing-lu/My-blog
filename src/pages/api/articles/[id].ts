/**
 * GET /api/articles/[id] —— 载入草稿 / 删除文章
 *
 * 服务端拦截模式下正文明文存库，管理端直接返回即可，无需密码解密。
 */
import type { APIRoute } from 'astro';
import { deleteArticle, getArticleById } from '@/lib/articles';
import { db } from '../../../../db';
import { articles } from '../../../../db/schema.sqlite';
import { and, eq } from 'drizzle-orm';
import { contentVersion } from '@/lib/article-content-version';
import { badJson, badRequest, guardManager, json, missing, notFound, readJson, serializeArticle } from '@/lib/api';

export const prerender = false;

/** 载入草稿 */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  const article = await getArticleById(id);
  if (!article) return notFound('文章不存在');

  return json({ article: serializeArticle(article), contentHash: contentVersion(article.content) });
};

/** 共用原位编辑器只更新正文；其余文章属性始终以服务端最新值保存。 */
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<{ content?: unknown; expectedContentHash?: unknown }>(request);
  if (!body) return badJson();
  if (typeof body.content !== 'string') return badRequest('正文必须是字符串');
  try {
    const original = await getArticleById(id);
    if(!original)return notFound('文章不存在');
    if(body.expectedContentHash!==undefined && body.expectedContentHash!==contentVersion(original.content)) {
      if(body.content===original.content)return json({node:{updatedAt:original.updatedAt.toISOString()},contentHash:contentVersion(original.content)});
      return json({error:'正文已变化，当前修改未覆盖'},409);
    }
    const rows = await db.update(articles)
      .set({ content: body.content, updatedAt: new Date() })
      .where(and(eq(articles.id, id), ...(body.expectedContentHash!==undefined?[eq(articles.content,original.content)]:[])))
      .returning({ updatedAt: articles.updatedAt });
    if (!rows[0]) return json({error:'正文已变化，当前修改未覆盖'},409);
    return json({ node: { updatedAt: rows[0].updatedAt.toISOString() }, contentHash: contentVersion(body.content) });
  } catch (error) {
    console.error('[api/articles/inline-save]', error);
    return json({ error: '保存失败' }, 500);
  }
};

/** 删除文章 */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  await deleteArticle(id);
  return json({ ok: true });
};
