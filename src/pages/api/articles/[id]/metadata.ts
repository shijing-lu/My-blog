/** 首页文章专属设置：以服务端最新正文为准，避免设置保存覆盖原位编辑内容。 */
import type { APIRoute } from 'astro';
import { getArticleById, saveDraft } from '@/lib/articles';
import { ArticlePasswordError } from '@/lib/article-password';
import { badJson, badRequest, guardManager, json, missing, notFound, readJson, serializeArticle } from '@/lib/api';
import { isArticleType } from '../../../../../db/types';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  const current = await getArticleById(id);
  if (!current) return notFound('文章不存在');
  const type = body.type === undefined ? current.type : body.type;
  if (!isArticleType(type)) return badRequest('文章类型无效');
  const tags = body.tags === undefined ? current.tags : body.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) return badRequest('标签必须是字符串数组');
  const encrypted = body.encrypted === undefined ? current.encrypted : body.encrypted;
  if (typeof encrypted !== 'boolean') return badRequest('密码开关无效');
  const encryptPassword = typeof body.encryptPassword === 'string' && body.encryptPassword ? body.encryptPassword : undefined;
  const encrypt = encrypted ? (encryptPassword || !current.encrypted ? true : undefined) : current.encrypted ? 'disable' : undefined;
  try {
    const saved = await saveDraft({
      id,
      title: typeof body.title === 'string' ? body.title.trim() : current.title,
      type,
      summary: typeof body.summary === 'string' ? body.summary : current.summary,
      cover: typeof body.cover === 'string' ? body.cover : current.cover ?? '',
      tags: tags as string[],
      content: current.content,
      encrypt,
      encryptPassword,
      encryptHint: typeof body.encryptHint === 'string' ? body.encryptHint : current.encryptHint,
    });
    return json({ article: serializeArticle(saved) });
  } catch (error) {
    if (error instanceof ArticlePasswordError) return badRequest(error.message);
    console.error('[api/articles/metadata]', error);
    return json({ error: '保存文章设置失败' }, 500);
  }
};
