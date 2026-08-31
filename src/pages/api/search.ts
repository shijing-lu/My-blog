/**
 * GET /api/search —— 首页服务端搜索（公开）
 *
 * 请求：?q=<关键词>&type=<all|tech|note|photo>
 * 返回：{ articles: [{ id, title, slug, type, summary, cover, tags, updatedAt, charCount }], total }
 * - cover 已按「手动封面 > 正文首图」解析好，前端直接渲染卡片；
 * - 结果按更新时间倒序，最多返回 50 条。
 */
import type { APIRoute } from 'astro';
import { listArticles, resolveCover } from '@/lib/articles';
import { json } from '@/lib/api';
import { countChars } from '@/lib/reading';
import { cardCoverUrl } from '@/lib/images';
import { isArticleType } from '../../../db/types';

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
    if (!q) return true;
    return (
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const articles = matched.slice(0, MAX_RESULTS).map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    type: a.type,
    summary: a.summary,
    cover: cardCoverUrl(resolveCover(a)),
    tags: a.tags,
    updatedAt: a.updatedAt.toISOString(),
    charCount: countChars(a.content),
  }));

  return json(
    { articles, total: matched.length, query: q, type },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
};
