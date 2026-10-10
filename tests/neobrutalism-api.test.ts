import type { APIContext } from 'astro';
import { describe, expect, it, vi, afterEach } from 'vitest';
const state = vi.hoisted(() => ({ authorized: true }));
vi.mock('../src/lib/admin-auth', () => ({ hasAnyPermission: vi.fn(async (_cookies: unknown, permissions: string[]) => state.authorized && permissions.includes('settings')) }));
import { GET, PUT } from '../src/pages/api/ui-style';
import { getSiteUiStyle } from '../src/lib/ui-style-server';
const context = (body: unknown) => ({ request: new Request('http://localhost/api/ui-style', { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }), cookies:{} }) as APIContext;
afterEach(() => { state.authorized = true; });
describe('single-style compatibility endpoint', () => {
  it('returns the existing response shape without database dependency', async () => { const r=await GET({} as APIContext); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store'); expect(await r.json()).toEqual({defaultStyle:'neobrutalism'}); expect(await getSiteUiStyle()).toBe('neobrutalism'); });
  it.each(['classic','material3','inherit','Material3','',null])('rejects retired or invalid style %s', async defaultStyle => { expect((await PUT(context({defaultStyle}))).status).toBe(400); });
  it('retains permission protection even for the only accepted style', async () => { state.authorized=false; expect((await PUT(context({defaultStyle:'neobrutalism'}))).status).toBe(403); });
  it('accepts the sole style without creating a new settings row', async () => { const r=await PUT(context({defaultStyle:'neobrutalism'})); expect(r.status).toBe(200); expect(await r.json()).toEqual({defaultStyle:'neobrutalism'}); });
});
