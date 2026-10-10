import { listArticleMeta, getArticleContents } from './articles';
import { listDocSearchPage } from './docs';
import { matchMeta, stripMarkdown, extractSnippet } from './search';

export interface SiteSearchHit { id: string; source: 'article' | 'doc'; title: string; location: string; snippet: string; url: string; encrypted: boolean; updatedAt: string }
export function searchableBody(source: string): string {
  return stripMarkdown(source.replace(/^\s*(?:```|~~~).*$/gm, '')).toLowerCase();
}
export async function searchSite(query: string, page: number, pageSize: number) {
  const q = query.trim().toLowerCase();
  const hits: SiteSearchHit[] = [];
  const metas = await listArticleMeta();
  // Scan in bounded batches, without excluding old articles or reading protected bodies.
  for (let offset = 0; offset < metas.length; offset += 100) {
    const rows = metas.slice(offset, offset + 100);
    const bodies = q ? await getArticleContents(rows.filter(row => !row.encrypted && !matchMeta(row, q)).map(row => row.id)) : new Map<string, string>();
    for (const row of rows) {
      const metaMatch = matchMeta(row, q), body = bodies.get(row.id);
      if (!metaMatch && (body === undefined || !searchableBody(body).includes(q))) continue;
      hits.push({ id: row.id, source: 'article', title: row.title, location: '文章', snippet: row.encrypted || metaMatch ? row.summary : extractSnippet(searchableBody(body!), q) || row.summary, url: `/blog/${encodeURIComponent(row.slug)}`, encrypted: row.encrypted, updatedAt: row.updatedAt.toISOString() });
    }
  }
  for (let offset = 0; ; offset += 100) {
    const rows = await listDocSearchPage(offset, 100);
    for (const row of rows) {
      const body = searchableBody(row.content);
      if (q && !row.title.toLowerCase().includes(q) && !body.includes(q)) continue;
      hits.push({ id: row.id, source: 'doc', title: row.title, location: row.bundleName, snippet: q ? extractSnippet(body, q) || body.slice(0, 140) : body.slice(0, 140), url: `/doc/${encodeURIComponent(row.bundleId)}?article=${encodeURIComponent(row.id)}`, encrypted: false, updatedAt: row.updatedAt.toISOString() });
    }
    if (rows.length < 100) break;
  }
  hits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  return { articles: hits.slice((page - 1) * pageSize, page * pageSize), total: hits.length, query: q, scope: 'site', page, pageSize };
}
