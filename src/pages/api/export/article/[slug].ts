/**
 * GET /api/export/article/[slug] —— 导出单篇文章的 Markdown 源文（附件下载）
 *
 * 只读 DB 的 `content`（MDX 源码），不走 renderMdx —— 无渲染耗时，也不受
 * 文档系统大文延迟阈值影响。加密文章复用详情页同一门禁（decideArticleGate
 * + 解锁 Cookie），未解锁不下发正文；因此响应按登录态对待，全程 no-store。
 */
import type { APIRoute } from 'astro';
import { notFound, unauthorized } from '@/lib/api';
import { getArticleBySlug } from '@/lib/articles';
import {
  decideArticleGate,
  decodeTokenPayload,
  isArticleUnlocked,
  parsePasswordHash,
} from '@/lib/article-password';
import { verifySignedPayload } from '@/lib/auth';
import { buildMarkdownExport } from '@/lib/export';
import { serverEnv } from '@/lib/env';

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies, url }) => {
  const article = params.slug ? await getArticleBySlug(params.slug) : null;
  if (!article) return notFound('文章不存在');

  const { locked } = decideArticleGate(
    Boolean(article.encrypted),
    article.encrypted ? parsePasswordHash(article.encryptMeta) : null,
    () => isArticleUnlocked(cookies, article.id, verifySignedPayload, decodeTokenPayload),
  );
  if (locked) return unauthorized('解锁文章后才能导出');

  const { body, headers } = buildMarkdownExport({
    meta: {
      title: article.title,
      extra: { slug: article.slug, type: article.type },
      tags: article.tags,
      summary: article.summary,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    },
    source: article.content,
    origin: serverEnv('PUBLIC_SITE_URL') || url.origin,
  });
  return new Response(body, { status: 200, headers });
};
