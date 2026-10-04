import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

describe('文章保存即生效', () => {
  it('新建和修改都立即可读取，不需要发布操作', async () => {
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
    const { createArticle, getArticleBySlug, listAdminArticleMeta, listArticleMeta, saveDraft } = await import('../src/lib/articles');

    const draft = await createArticle();
    expect((await getArticleBySlug('old'))?.published).toBe(true);
    expect(draft.published).toBe(true);
    expect((await listArticleMeta()).some((article) => article.id === draft.id)).toBe(true);
    expect((await listAdminArticleMeta()).some((article) => article.id === draft.id)).toBe(true);
    expect(await getArticleBySlug(draft.slug)).toMatchObject({ id: draft.id });

    await saveDraft({ id: draft.id, title: '自动保存验收', content: '最新正文', type: 'tech', summary: '', cover: '', tags: [] });
    expect(await getArticleBySlug(draft.slug)).toMatchObject({ id: draft.id, content: '最新正文', published: true });
    const raw = new Database(dbPath);
    raw.prepare('UPDATE articles SET published = 0 WHERE id = ?').run(draft.id);
    raw.close();
    expect(await getArticleBySlug(draft.slug)).toMatchObject({ id: draft.id, content: '最新正文' });
    expect((await listArticleMeta()).some(article => article.id === draft.id)).toBe(true);
  });
});
