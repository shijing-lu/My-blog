import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), local: vi.fn(), status: vi.fn(), save: vi.fn(), test: vi.fn() }));
vi.mock('../src/lib/api', () => ({ guardTopAdmin: mocks.owner, json: (value: unknown, init: ResponseInit) => new Response(JSON.stringify(value), init) }));
vi.mock('../src/sync', () => ({ syncStatus: mocks.status }));
vi.mock('../src/lib/local-sync-config', async importOriginal => ({ ...(await importOriginal<object>()), localAppMode: mocks.local, saveCloudConnections: mocks.save, testCloudConnections: mocks.test }));
import { GET, PUT, POST } from '../src/pages/api/desktop/sync-config';
function context(method = 'GET', body?: string, origin?: string, hostname = 'localhost') {
  return { request: new Request(`http://${hostname}:43221/api/desktop/sync-config`, { method, body, headers: origin ? { origin } : {} }), cookies: {} } as Parameters<typeof GET>[0];
}
beforeEach(() => { mocks.owner.mockReset().mockResolvedValue(null); mocks.local.mockReset().mockReturnValue(true); mocks.status.mockReset().mockReturnValue({ running: false }); mocks.save.mockReset().mockResolvedValue({ cloudConfigured: true }); mocks.test.mockReset(); });
it('rejects public runtime and non-loopback hosts', async () => {
  mocks.local.mockReturnValue(false); expect((await GET(context())).status).toBe(403);
  mocks.local.mockReturnValue(true); expect((await GET(context('GET', undefined, undefined, 'example.com'))).status).toBe(403);
});
it('rejects non-owner and foreign Origin without accessing config', async () => {
  mocks.owner.mockResolvedValue(new Response(null, { status: 403 })); expect((await PUT(context('PUT', '{}'))).status).toBe(403);
  mocks.owner.mockResolvedValue(null); expect((await PUT(context('PUT', '{}', 'https://foreign.example'))).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled();
});
it('returns status booleans only and prevents caching', async () => {
  const response = await GET(context()); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(Object.values(await response.json()).every(value => typeof value === 'boolean')).toBe(true);
});
it('blocks changes while synchronizing', async () => { mocks.status.mockReturnValue({ running: true }); expect((await PUT(context('PUT', '{}'))).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled(); });
it.each(['broken JSON', 'null', '[]', '"text"'])('rejects malformed requests: %s', async body => { expect((await PUT(context('PUT', body))).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled(); });
it('saves only after guards and recognizes unknown actions', async () => {
  expect((await PUT(context('PUT', '{"primaryUrl":"fixture"}', 'http://localhost:43221'))).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith({ primaryUrl: 'fixture' }); expect((await POST(context('POST', '{"action":"unknown"}'))).status).toBe(400);
});
