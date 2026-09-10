/**
 * GET /api/search —— 首页服务端搜索（公开）
 *
 * 请求：?q=<关键词>&type=<all|tech|note|photo>
 * 返回：{ articles: [{ id, title, slug, type, summary, snippet, cover, tags, updatedAt, charCount }], total }
 * - 匹配范围：标题 / 摘要 / 标签 / **正文**（正文剥离 Markdown 语法后匹配）；
 * - snippet：正文命中时返回命中处上下文片段（前端展示「为什么命中」），
 *   标题/摘要/标签命中（或无关键词）时回退为 summary；
 * - cover 已按「手动封面 > 正文首图」解析好，前端直接渲染卡片；
 * - 结果按更新时间倒序，最多返回 50 条。
 */
import type { APIRoute } from 'astro';
import { listArticles, resolveCover } from '@/lib/articles';
import { json } from '@/lib/api';
import { countChars } from '@/lib/reading';
import { cardCoverUrl } from '@/lib/images';
import { isArticleType } from '../../../db/types';
import { extractSnippet, matchArticle } from '@/lib/search';

export const prerender = false;

/** 搜索结果上限 */
const MAX_RESULTS = 50;

/** GET 处理器 */
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const type = url.searchParams.get('type') ?? 'all';
  if (type !== 'all' && !isArticleType(type)) {
    return json({ error: 'type 不合法' }, 400);
  }

  const all = await listArticles();
  const matched = all.filter((a) => {
    if (type !== 'all' && a.type !== type) return false;
    return matchArticle(a, q);
  });

  const articles = matched.slice(0, MAX_RESULTS).map((a) => {
    // 加密文章 content 落库为空串 → 天然不会「正文命中」；snippet 回退为摘要。
    // 前端据 encrypted 显示锁标识并提示需解锁。
    const snippet = a.encrypted ? a.summary : (extractSnippet(a.content, q) ?? a.summary);
    return {
      id: a.id,
      title: a.title,
      slug: a.slug,
      type: a.type,
      summary: a.summary,
      snippet,
      cover: cardCoverUrl(resolveCover(a)),
      tags: a.tags,
      encrypted: a.encrypted,
      updatedAt: a.updatedAt.toISOString(),
      charCount: a.encrypted ? 0 : countChars(a.content),
    };
  });

  return json(
    { articles, total: matched.length, query: q, type },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
};
