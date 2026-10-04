import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BlogDb } from '../db';

const state = vi.hoisted(() => ({ db: undefined as unknown as BlogDb }));
vi.mock('../db', () => ({ get db() { return state.db; }, dbWrite: vi.fn() }));
vi.mock('../db/dialect', () => ({ isPostgres: false }));
vi.mock('../src/lib/mdx', () => ({ clearRenderCache: vi.fn(), invalidateRenderCache: vi.fn() }));
import { listDocTree, searchDocs } from '../src/lib/docs';

let sqlite: InstanceType<typeof Database>;
let queries: string[];
beforeEach(() => {
  sqlite = new Database(':memory:');
  queries = [];
  state.db = drizzle(sqlite, { logger: { logQuery(query) { queries.push(query); } } }) as BlogDb;
  sqlite.exec(`
    CREATE TABLE doc_categories (id TEXT, name TEXT, sort INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE doc_bundles (id TEXT, category_id TEXT, name TEXT, icon TEXT, summary TEXT, sort INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE doc_articles (id TEXT, bundle_id TEXT, title TEXT, content TEXT, sort INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE doc_nodes (id TEXT, bundle_id TEXT, parent_id TEXT, kind TEXT, title TEXT, content TEXT, sort INTEGER, created_at INTEGER, updated_at INTEGER);
    INSERT INTO doc_categories VALUES ('cat', '数学', 0, 0, 0);
    INSERT INTO doc_bundles VALUES ('book', 'cat', 'Astro Notes', NULL, '使用指南', 0, 0, 0);
    INSERT INTO doc_nodes VALUES ('folder', 'book', NULL, 'folder', 'Astro 目录', '', 0, 0, 0);
    INSERT INTO doc_nodes VALUES ('node', 'book', NULL, 'article', '第一章', 'ASTRO 文本 100% foo_bar hello!', 1, 0, 0);
    INSERT INTO doc_articles VALUES ('old', 'book', 'Legacy Astro', '旧版本正文', 0, 0, 0);
  `);
});
afterEach(() => sqlite.close());

describe('文档查询（真实内存 SQLite）', () => {
  it('搜索不再生成 SQLite 不支持的 ILIKE，匹配英文大小写且排除文件夹', async () => {
    const result = await searchDocs('astro');
    expect(result.bundles.map(b => b.id)).toEqual(['book']);
    expect(result.articles.map(a => a.id)).toEqual(['node', 'old']);
    expect(queries.join('\n')).not.toMatch(/\bilike\b/i);
  });
  it('分类名可命中文档', async () => {
    expect((await searchDocs('数学')).bundles[0]?.id).toBe('book');
  });
  it.each(['%', '_', '!'])('通配符 %s 按字面匹配', async (term) => {
    expect((await searchDocs(term)).articles.map(a => a.id)).toEqual(['node']);
  });
  it('新旧文章合并后仍遵守总条数上限', async () => {
    expect((await searchDocs('astro', 1)).articles).toHaveLength(1);
  });
  it('空搜索不读取数据库', async () => {
    expect(await searchDocs('  ')).toEqual({ bundles: [], articles: [] });
    expect(queries).toEqual([]);
  });
  it('目录读取仅包含元信息，不从数据库传输长文正文', async () => {
    sqlite.prepare('UPDATE doc_articles SET content = ?').run('长文正文'.repeat(25000));
    const tree = await listDocTree();
    expect(tree[0]?.bundles[0]?.articles).toEqual([{ id: 'old', title: 'Legacy Astro', sort: 0 }]);
    expect(tree[0]?.bundles[0]?.articleCount).toBe(1);
    expect(tree[0]?.bundles[0]?.folderCount).toBe(1);
    const query = queries.find(q => q.includes('from "doc_articles"'));
    expect(query).toBeDefined();
    expect(query?.split('from')[0]).not.toContain('content');
  });
});
