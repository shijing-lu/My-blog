/**
 * API 通用工具：JSON 响应与文章序列化
 */
import type { Article } from '../../db/types';

/** 构造 JSON 响应（兼容 status 数字或 ResponseInit 两种用法） */
export function json(data: unknown, init: number | ResponseInit = 200): Response {
  const status = typeof init === 'number' ? init : (init.status ?? 200);
  const headers = new Headers(typeof init === 'object' ? init.headers : undefined);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * 公开 GET 数据的 CDN 缓存响应（短 TTL + stale-while-revalidate）。
 * 仅用于**公开、低频变化**的读取接口（列表/配置/统计）；登录态、写接口禁用。
 * 由 Vercel 边缘（及前置 Cloudflare）缓存，显著降低源站/数据库请求量。
 */
export function jsonCached(data: unknown, sMaxAge = 30, swr = 300): Response {
  return json(data, {
    headers: {
      'cache-control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
    },
  });
}

/** 文章实体 → 可序列化对象（Date → ISO 字符串） */
export function serializeArticle(article: Article): {
  id: string;
  title: string;
  slug: string;
  content: string;
  type: Article['type'];
  summary: string;
  cover: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    content: article.content,
    type: article.type,
    summary: article.summary,
    cover: article.cover,
    tags: article.tags,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}
