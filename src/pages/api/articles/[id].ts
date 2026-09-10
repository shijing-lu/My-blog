/**
 * GET /api/articles/[id] —— 载入草稿 / 删除文章
 *
 * 加密文章：`content` 列是空串，正文以密文存于 `encrypt_meta`。
 * 管理端二次编辑需要明文 → 支持通过查询参数 `password` 在服务端解密后返回。
 * （访客侧解密走浏览器 Web Crypto，服务端不参与，见 blog/[slug].astro）
 *
 * ⚠️ 本接口仅用于管理端写作台；密码通过 query 传递存在被日志记录的风险，
 * 因此仅在「编辑已加密草稿」这一内部场景使用，且不落日志。
 */
import type { APIRoute } from 'astro';
import { deleteArticle, getArticleById } from '@/lib/articles';
import { json, serializeArticle } from '@/lib/api';
import { decryptContent, parseEncryptMeta } from '@/lib/article-crypto';

export const prerender = false;

/** 载入草稿 */
export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const article = await getArticleById(id);
  if (!article) return json({ error: '文章不存在' }, 404);

  // 加密文章 + 提供了密码 → 服务端解密后把明文一并返回，便于写作台直接续写
  let content = article.content;
  let decryptError: string | undefined;
  if (article.encrypted && content === '') {
    const password = url.searchParams.get('password') ?? '';
    const meta = parseEncryptMeta(article.encryptMeta);
    if (password && meta) {
      const plain = decryptContent(meta, password);
      if (plain === null) decryptError = '密码错误，无法载入明文';
      else content = plain;
    }
  }

  return json({
    article: { ...serializeArticle(article), content },
    ...(decryptError ? { decryptError } : {}),
  });
};

/** 删除文章 */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  await deleteArticle(id);
  return json({ ok: true });
};
