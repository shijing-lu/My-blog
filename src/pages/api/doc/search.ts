/**
 * GET /api/doc/search?q= —— 文档内搜索（公开）
 *
 * 匹配分类名/文档名/简介/文章标题/正文（大小写不敏感），返回分组命中。
 */
import type { APIRoute } from 'astro';
import { json, jsonCached } from '@/lib/api';
import { searchDocs } from '@/lib/docs';

export const prerender = false;

const MAX_Q = 100;

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_Q);
  if (!q) return jsonCached({ bundles: [], articles: [] });
  try {
    const result = await searchDocs(q);
    return jsonCached(result);
  } catch (err) {
    console.error('[api/doc/search]', err);
    return json({ error: '搜索失败' }, 500);
  }
};
