import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

describe('文章草稿发布边界', () => {
  it('新建草稿仅管理员可见，发布后公开详情可读取', async () => {
    const dir = join(process.cwd(), '.diag', 'article-publication-test');
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, `${crypto.randomUUID()}.db`);
    const legacy = new Database(dbPath);
    legacy.exec(`CREATE TABLE articles (
      id text PRIMARY KEY NOT NULL, title text NOT NULL, slug text NOT NULL UNIQUE,
      content text NOT NULL DEFAULT '', type text NOT NULL DEFAULT 'tech',
      summary text NOT NULL DEFAULT '', cover text, tags text NOT NULL DEFAULT '[]',
      encrypted integer NOT NULL DEFAULT 0, encrypt_hint text NOT NULL DEFAULT '',
      encrypt_meta text NOT NULL DEFAULT '', created_at integer NOT NULL, updated_at integer NOT NULL
    )`);
    legacy.prepare(`INSERT INTO articles (id, title, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('old', '旧文章', 'old', Date.now(), Date.now());
    legacy.close();
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.DESKTOP_MODE = '1';
    delete process.env.DATABASE_URL_FALLBACK;
    const { createArticleDraft, getArticleBySlug, listAdminArticleMeta, listArticleMeta, publishArticle, saveDraft } = await import('../src/lib/articles');

    const draft = await createArticleDraft();
    expect((await getArticleBySlug('old'))?.published).toBe(true);
    expect(draft.published).toBe(false);
    expect((await listArticleMeta()).some((article) => article.id === draft.id)).toBe(false);
    expect((await listAdminArticleMeta()).some((article) => article.id === draft.id)).toBe(true);
    expect(await getArticleBySlug(draft.slug)).toBeNull();

    await saveDraft({ id: draft.id, title: '发布验收', content: '正文', type: 'tech', summary: '', cover: '', tags: [] });
    const published = await publishArticle(draft.id);
    expect(published?.published).toBe(true);
    expect(await getArticleBySlug(published!.slug)).toMatchObject({ id: draft.id, published: true });
  });
});
