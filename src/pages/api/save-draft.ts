/**
 * POST /api/save-draft —— 防抖自动保存（按 id upsert）
 */
import type { APIRoute } from 'astro';
import { saveDraft } from '@/lib/articles';
import { json, serializeArticle } from '@/lib/api';
import { ARTICLE_TYPES, isArticleType } from '../../../db/types';

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
  const type = body.type;
  const tagsRaw = body.tags;

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
      tags: tagsRaw as string[],
      content,
    });
    return json({ ok: true, article: serializeArticle(article) });
  } catch (err) {
    console.error('[api/save-draft]', err);
    return json({ error: '保存失败' }, 500);
  }
};
