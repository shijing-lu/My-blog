import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
vi.mock('../src/sync/adapters/sqlite-endpoint', () => ({ SqliteEndpoint: vi.fn() }));
vi.mock('../src/sync/adapters/pg-endpoint', () => ({ PgEndpoint: vi.fn() }));
vi.mock('../src/sync/local-store', () => ({ LocalSyncStore: vi.fn() }));
import { startSync, syncStatus } from '../src/sync';
beforeEach(() => { vi.stubEnv('DESKTOP_MODE', '1'); vi.stubEnv('SYNC_DATABASE_URL', ''); });
afterEach(() => vi.unstubAllEnvs());
it('missing cloud configuration is rejected before starting any background task', async () => {
  const result = await startSync(false);
  expect(result).toMatchObject({ started: false, running: false }); expect(result.error).toContain('设置 → 云端同步');
  expect(syncStatus()).toMatchObject({ running: false, progress: null, cloudConfigured: false });
});
it('already configured connections are recognized before the first sync', () => {
  process.env.SYNC_DATABASE_URL = 'postgresql://fixture:test@cloud.invalid/blog';
  expect(syncStatus().cloudConfigured).toBe(true);
  expect(syncStatus().lastError).toBe(null);
});
