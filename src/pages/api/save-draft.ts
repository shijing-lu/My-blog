/**
 * POST /api/save-draft —— 防抖自动保存（按 id upsert）
 *
 * 加密相关入参（可选）：
 * - `encrypt: true` + `encryptPassword` → 服务端加密正文后落库
 * - `encrypt: 'disable'` → 取消加密，回填明文
 * - 两者都不传 → 保留文章原有加密状态（自动保存不会破坏密文）
 */
import type { APIRoute } from 'astro';
import { saveDraft } from '@/lib/articles';
import { badJson, badRequest, json, missing, readJson, serializeArticle } from '@/lib/api';
import { ARTICLE_TYPES, isArticleType } from '../../../db/types';
import { ArticlePasswordError } from '@/lib/article-password';

export const prerender = false;

/** 保存处理 */
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();

  const id = typeof body.id === 'string' && body.id !== '' ? body.id : null;
  const title = typeof body.title === 'string' ? body.title : '';
  const content = typeof body.content === 'string' ? body.content : '';
  const summary = typeof body.summary === 'string' ? body.summary : '';
  const cover = typeof body.cover === 'string' ? body.cover : '';
  const type = body.type;
  const tagsRaw = body.tags;

  // 加密开关：true | 'disable' | 缺省（保留原状态）
  const encrypt = body.encrypt === true ? true : body.encrypt === 'disable' ? 'disable' : undefined;
  const encryptPassword = typeof body.encryptPassword === 'string' ? body.encryptPassword : undefined;
  const encryptHint = typeof body.encryptHint === 'string' ? body.encryptHint : undefined;

  // 可选：显式指定 slug（为空则由标题自动生成 / 沿用原值）
  const slug = typeof body.slug === 'string' && body.slug.trim() !== '' ? body.slug.trim() : undefined;

  if (!id) return missing('id');
  if (!isArticleType(type)) {
    return json({ error: `type 必须为 ${ARTICLE_TYPES.join(' | ')}` }, 400);
  }
  if (!Array.isArray(tagsRaw) || tagsRaw.some((t) => typeof t !== 'string')) {
    return badRequest('tags 必须为字符串数组');
  }

  try {
    const article = await saveDraft({
      id,
      title,
      type,
      summary,
      cover,
      tags: tagsRaw as string[],
      content,
      slug,
      encrypt,
      encryptPassword,
      encryptHint,
    });
    return json({ ok: true, article: serializeArticle(article) });
  } catch (err) {
    // 密码强度等参数错误 → 400，消息可直接展示给用户
    if (err instanceof ArticlePasswordError) {
      return badRequest(err.message);
    }
    console.error('[api/save-draft]', err);
    return json({ error: '保存失败' }, 500);
  }
};
