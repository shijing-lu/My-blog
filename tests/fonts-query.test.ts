import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BlogDb } from '../db';
const state = vi.hoisted(() => ({ db: undefined as unknown as BlogDb }));
vi.mock('../db', () => ({ get db() { return state.db; }, dbWrite: vi.fn() }));
vi.mock('../db/dialect', () => ({ isPostgres: false }));
import { buildFontCss, getFontsByIds, getSiteFontState } from '../src/lib/fonts';
let sqlite: InstanceType<typeof Database>;
let queries: string[];
beforeEach(() => {
  sqlite = new Database(':memory:');
  queries = [];
  state.db = drizzle(sqlite, { logger: { logQuery(query) { queries.push(query); } } }) as BlogDb;
  sqlite.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
    CREATE TABLE fonts (id TEXT PRIMARY KEY, family_name TEXT, mime TEXT, data TEXT, size INTEGER, created_at INTEGER);
  `);
});
afterEach(() => sqlite.close());
describe('字体 SSR 读取', () => {
  it('单次查询返回字体设置与手动配置标记', async () => {
    sqlite.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('site_fonts', JSON.stringify({ article: { type: 'custom', value: 'font' }, ui: { type: 'system', value: 'sans' } }), 0);
    const result = await getSiteFontState();
    expect(result.hasManualFonts).toBe(true);
    expect(result.fonts.article.value).toBe('font');
    expect(queries).toHaveLength(1);
  });
  it('未配置跟随主题，损坏的配置仍安全回落', async () => {
    expect((await getSiteFontState()).hasManualFonts).toBe(false);
    sqlite.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('site_fonts', '{bad json', 0);
    expect((await getSiteFontState()).hasManualFonts).toBe(true);
  });
  it('不传输 base64 字节，保留字体 API 地址与远程字体 URL', async () => {
    const payload = 'YWJj'.repeat(131072);
    sqlite.prepare('INSERT INTO fonts VALUES (?, ?, ?, ?, ?, ?)').run('embedded', 'LocalFont', 'font/woff2', payload, payload.length, 0);
    sqlite.prepare('INSERT INTO fonts VALUES (?, ?, ?, ?, ?, ?)').run('remote', 'RemoteFont', 'font/woff2', 'https://fonts.example.test/a.woff2', 500, 0);
    const fonts = await getFontsByIds(['embedded', 'remote', 'embedded']);
    expect(fonts).toHaveLength(2);
    expect(fonts.find(f => f.id === 'embedded')?.data).toBe('');
    expect(JSON.stringify(fonts).length).toBeLessThan(1000);
    const css = buildFontCss({ article: { type: 'custom', value: 'embedded' }, ui: { type: 'custom', value: 'remote' } }, fonts);
    expect(css).toContain('/api/fonts/embedded');
    expect(css).toContain('https://fonts.example.test/a.woff2');
  });
  it('没有自定义字体时不查询字体表', async () => {
    expect(await getFontsByIds([])).toEqual([]);
    expect(queries).toEqual([]);
  });
});
