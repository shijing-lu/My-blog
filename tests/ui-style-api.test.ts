import type { APIContext } from 'astro';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.sqlite';
import type { BlogDb } from '../db';

const state = vi.hoisted(() => ({ primary: null as BlogDb | null, fallback: null as BlogDb | null, authorized: true, rejectWrites: false }));
vi.mock('../db', () => ({
  get db() { return state.primary; },
  dbWrite: async (build: (database: BlogDb, postgres: boolean) => Promise<unknown>) => {
    if (state.rejectWrites) throw Error('all endpoints unavailable');
    const primary = await build(state.primary!, false);
    await build(state.fallback!, false);
    return primary;
  },
}));
vi.mock('../src/lib/admin-auth', () => ({ hasAnyPermission: vi.fn(async (_cookies: unknown, permissions: string[]) => state.authorized && permissions.includes('settings')) }));

import { GET, PUT } from '../src/pages/api/ui-style';
import { getSiteUiStyle, saveSiteUiStyle } from '../src/lib/ui-style-server';

describe('site UI style persistence and endpoint', () => {
  let primary: Database.Database;
  let fallback: Database.Database;
  beforeEach(() => {
    primary = new Database(':memory:'); fallback = new Database(':memory:');
    for (const database of [primary, fallback]) database.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    state.primary = drizzle(primary, { schema }); state.fallback = drizzle(fallback, { schema }); state.authorized = true; state.rejectWrites = false;
  });
  afterEach(() => { primary.close(); fallback.close(); vi.restoreAllMocks(); });

  function context(body: unknown): APIContext {
    return { request: new Request('http://localhost/api/ui-style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), cookies: {} } as APIContext;
  }

  it('defaults older installations to classic, public GET is uncached', async () => {
    state.authorized = false;
    const response = await GET({} as APIContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ defaultStyle: 'classic' });
  });

  it('upserts the existing settings row to both databases with identical timestamps', async () => {
    await saveSiteUiStyle('material3');
    expect(await getSiteUiStyle()).toBe('material3');
    await saveSiteUiStyle('classic');
    const left = primary.prepare('SELECT * FROM settings').all();
    expect(left).toEqual(fallback.prepare('SELECT * FROM settings').all());
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ key: 'ui_style', value: '{"defaultStyle":"classic"}' });
  });

  it.each([{}, { defaultStyle: 'inherit' }, { defaultStyle: 'Material3' }, [], null])('rejects invalid values %j before writing', async (body) => {
    expect((await PUT(context(body))).status).toBe(400);
    expect(primary.prepare('SELECT count(*) AS count FROM settings').get()).toEqual({ count: 0 });
  });

  it('settings permission is required even if the handler is called directly', async () => {
    state.authorized = false;
    expect((await PUT(context({ defaultStyle: 'material3' }))).status).toBe(403);
    expect(primary.prepare('SELECT count(*) AS count FROM settings').get()).toEqual({ count: 0 });
  });

  it('writes valid setting and returns exact interface', async () => {
    const response = await PUT(context({ defaultStyle: 'material3' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ defaultStyle: 'material3' });
    expect(await getSiteUiStyle()).toBe('material3');
  });

  it('a failed save keeps the previous persisted default', async () => {
    await saveSiteUiStyle('material3');
    state.rejectWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await PUT(context({ defaultStyle: 'classic' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await getSiteUiStyle()).toBe('material3');
  });

  it('a database read error returns 500 instead of announcing a different default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(state.primary!, 'select').mockImplementation(() => { throw Error('database unavailable'); });
    const response = await GET({} as APIContext);
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: '读取界面风格失败' });
    expect(await getSiteUiStyle()).toBe('classic'); // SSR can still render the fallback shell.
  });
});
