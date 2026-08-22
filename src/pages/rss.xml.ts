/**
 * RSS 订阅源（/rss.xml）
 *
 * 输出 RSS 2.0，按更新时间倒序；站点地址取 PUBLIC_SITE_URL。
 */
import { listArticles } from '@/lib/articles';

/** 站点根地址（去尾部斜杠） */
const SITE = (import.meta.env.PUBLIC_SITE_URL as string | undefined ?? 'http://localhost:4321').replace(/\/+$/, '');

/** XML 转义 */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
    return map[c] ?? c;
  });
}

/** GET 处理器 */
export async function GET(): Promise<Response> {
  const articles = await listArticles();

  const items = articles
    .map(
      (a) => `
    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE}/blog/${esc(a.slug)}</link>
      <guid isPermaLink="false">${esc(a.id)}</guid>
      <pubDate>${a.updatedAt.toUTCString()}</pubDate>
      <description>${esc(a.summary)}</description>
      ${a.tags.map((t) => `<category>${esc(t)}</category>`).join('')}
    </item>`,
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>My Blog</title>
  <link>${SITE}</link>
  <description>技术教程 · 学习笔记 · 随笔与摄影</description>
  <language>zh-CN</language>
  <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
  ${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
