import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ meta: vi.fn(), content: vi.fn(), docs: vi.fn() }));
vi.mock('../src/lib/articles', () => ({ listArticleMeta: mocks.meta, getArticleContents: mocks.content }));
vi.mock('../src/lib/docs', () => ({ listDocSearchPage: mocks.docs }));
import { searchSite } from '../src/lib/site-search';
const meta = (id: string, encrypted = false) => ({ id, title: id, summary: '', tags: [], slug: id, encrypted, updatedAt: new Date(0) });
beforeEach(() => { vi.clearAllMocks(); mocks.docs.mockResolvedValue([]); });
it('finds old content beyond 300 articles, including fenced code, without scanning encrypted content', async () => {
  mocks.meta.mockResolvedValue([...Array.from({ length: 350 }, (_, i) => meta(String(i))), meta('locked', true)]);
  mocks.content.mockImplementation(async (ids: string[]) => new Map(ids.map(id => [id, id === '349' ? '```js\noldNeedle\n```' : 'body'])));
  const result = await searchSite('oldneedle', 1, 20); expect(result.total).toBe(1); expect(result.articles[0]?.id).toBe('349');
  expect(mocks.content.mock.calls.every(([ids]) => ids.length <= 100 && !ids.includes('locked'))).toBe(true);
});
it('merges documents and public metadata, returns targets, and paginates stable ordering', async () => {
  mocks.meta.mockResolvedValue([meta('locked', true)]); mocks.content.mockResolvedValue(new Map());
  mocks.docs.mockResolvedValue([{ id: 'node', title: 'Locked note', content: 'locked doc text', bundleId: 'book', bundleName: 'Book', updatedAt: new Date(1) }]);
  const first = await searchSite('locked', 1, 1), second = await searchSite('locked', 2, 1);
  expect(first.total).toBe(2); expect(first.articles[0]?.url).toBe('/doc/book?article=node');
  expect(second.articles[0]).toMatchObject({ source: 'article', encrypted: true, snippet: '' });
});
