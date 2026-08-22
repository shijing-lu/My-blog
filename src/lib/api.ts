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
