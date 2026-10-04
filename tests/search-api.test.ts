import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
const mocks = vi.hoisted(() => ({ list: vi.fn(), contents: vi.fn() }));
vi.mock('../src/lib/articles', () => ({
  listArticleMeta: mocks.list,
  getArticleContents: mocks.contents,
  resolveCover: ({ cover, content }: { cover: string | null; content: string }) => cover || content.match(/!\[.*?\]\((.*?)\)/)?.[1] || null,
}));
vi.mock('../src/lib/article-categories', () => ({ articleCategoryMap: async () => new Map() }));
vi.mock('../src/lib/images', () => ({ cardCoverUrl: (url: string) => url }));
import { GET } from '../src/pages/api/search';
const article = (id: string, encrypted = false) => ({
  id, title: 'Astro ' + id, slug: id, type: 'tech', summary: '公开摘要', tags: [],
  cover: null, encrypted, updatedAt: new Date(0),
});
const search = async (q: string) => {
  const response = await GET({ url: new URL('https://example.test/api/search?q=' + encodeURIComponent(q)) } as APIContext);
  return response.json();
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([article('public'), article('locked', true)]);
  mocks.contents.mockImplementation(async (ids: string[]) => new Map(ids.map(id => [id, id === 'locked' ? 'private-secret ![私密](https://private.test/image)' : '公开正文 ![图](https://public.test/image)'])));
});
describe('公开搜索边界', () => {
  it('设密码正文不能影响搜索结果，且不读取正文', async () => {
    expect((await search('private-secret')).articles).toEqual([]);
    expect(mocks.contents).toHaveBeenCalledWith(['public']);
  });
  it('标题命中保留公开摘要，但不泄露设密码文章的首图与字数', async () => {
    const data = await search('Astro');
    const locked = data.articles.find((a: { id: string }) => a.id === 'locked');
    expect(locked).toMatchObject({ snippet: '公开摘要', cover: null, charCount: 0 });
    expect(mocks.contents).toHaveBeenCalledWith(['public']);
  });
  it('标题命中的公开文章仍有正文字数和首图', async () => {
    const data = await search('Astro');
    const visible = data.articles.find((a: { id: string }) => a.id === 'public');
    expect(visible.charCount).toBeGreaterThan(0);
    expect(visible.cover).toBe('https://public.test/image');
    expect(visible.snippet).toBe('公开摘要');
  });
  it('展示补取只读取最多 50 条，已扫描的正文不重复读取', async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 80 }, (_, i) => article(String(i))));
    const data = await search('Astro');
    expect(data.articles).toHaveLength(50);
    expect(mocks.contents.mock.calls[0]?.[0]).toHaveLength(50);
    mocks.contents.mockClear();
    await search('公开正文');
    expect(mocks.contents).toHaveBeenCalledTimes(1);
  });
});
