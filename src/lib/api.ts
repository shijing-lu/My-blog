/**
 * API 通用工具：JSON 响应与文章序列化
 */
import type { Article } from '../../db/types';

/** 构造 JSON 响应 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
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
    tags: article.tags,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}
