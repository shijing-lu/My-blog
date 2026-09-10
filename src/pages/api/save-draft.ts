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
import { json, serializeArticle } from '@/lib/api';
import { ARTICLE_TYPES, isArticleType } from '../../../db/types';
import { ArticleCryptoError } from '@/lib/article-crypto';

export const prerender = false;

/** 保存处理 */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

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

  if (!id) return json({ error: '缺少 id' }, 400);
  if (!isArticleType(type)) {
    return json({ error: `type 必须为 ${ARTICLE_TYPES.join(' | ')}` }, 400);
  }
  if (!Array.isArray(tagsRaw) || tagsRaw.some((t) => typeof t !== 'string')) {
    return json({ error: 'tags 必须为字符串数组' }, 400);
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
      encrypt,
      encryptPassword,
      encryptHint,
    });
    return json({ ok: true, article: serializeArticle(article) });
  } catch (err) {
    // 密码强度等参数错误 → 400，消息可直接展示给用户
    if (err instanceof ArticleCryptoError) {
      return json({ error: err.message }, 400);
    }
    console.error('[api/save-draft]', err);
    return json({ error: '保存失败' }, 500);
  }
};
