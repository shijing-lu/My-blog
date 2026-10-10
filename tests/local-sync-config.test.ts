import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), client: vi.fn() }));
vi.mock('postgres', () => ({ default: mocks.client }));
import { cloudConnections, connectionSummary, decryptConnections, encryptConnections, mergeConnections, saveCloudConnections, testCloudConnections, validateConnection } from '../src/lib/local-sync-config';
const primary = 'postgresql://test:fixture@primary.invalid:5432/blog';
const backup = 'postgresql://test:fixture@backup.invalid:5432/blog';
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'byqx-sync-config-test-'));
  vi.stubEnv('DESKTOP_MODE', '1'); vi.stubEnv('BYQX_CONFIG_PATH', path.join(directory, 'config.json'));
  vi.stubEnv('SYNC_DATABASE_URL', ''); vi.stubEnv('SYNC_DATABASE_URL_FALLBACK', '');
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ ADMIN_PASSWORD: 'local-fixture', AUTH_SECRET: 'fixture-secret', untouched: true }));
  mocks.query.mockReset().mockResolvedValue([{ value: 1 }]); mocks.end.mockReset().mockResolvedValue(undefined);
  mocks.client.mockReset().mockReturnValue({ unsafe: mocks.query, end: mocks.end });
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });
describe('local cloud configuration', () => {
  it.each(['https://blog.example', 'file:database.db', 'postgresql://host/', 'not a url', primary + '\nsecret'])('rejects invalid connections without echoing credentials: %s', value => {
    expect(() => validateConnection(value)).toThrow();
  });
  it('status reflects runtime settings and returns no connection or credential', () => {
    expect(connectionSummary().cloudConfigured).toBe(false); process.env.SYNC_DATABASE_URL = primary;
    const summary = connectionSummary(); expect(summary.cloudConfigured).toBe(true); expect(JSON.stringify(summary)).not.toContain('fixture');
  });
  it('persists both connections, applies immediately, and preserves unrelated local configuration', async () => {
    await saveCloudConnections({ primaryUrl: primary, fallbackUrl: backup });
    const config = JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8'));
    expect(config).toMatchObject({ ADMIN_PASSWORD: 'local-fixture', AUTH_SECRET: 'fixture-secret', untouched: true, SYNC_DATABASE_URL: primary, SYNC_DATABASE_URL_FALLBACK: backup });
    expect(cloudConnections()).toEqual({ primaryUrl: primary, fallbackUrl: backup });
    expect(await fs.readdir(directory)).toEqual(['config.json']);
  });
  it('blank fields retain existing connections; removing backup is explicit', async () => {
    await saveCloudConnections({ primaryUrl: primary, fallbackUrl: backup });
    expect(mergeConnections({ primaryUrl: '', fallbackUrl: '' })).toEqual({ primaryUrl: primary, fallbackUrl: backup });
    await saveCloudConnections({ clearFallback: true }); expect(cloudConnections().fallbackUrl).toBe('');
  });
  it('failed save leaves configuration and runtime unchanged', async () => {
    await fs.writeFile(path.join(directory, 'config.json'), 'invalid JSON');
    await expect(saveCloudConnections({ primaryUrl: primary })).rejects.toThrow('原配置未改动');
    expect(cloudConnections().primaryUrl).toBe(''); expect(await fs.readFile(path.join(directory, 'config.json'), 'utf8')).toBe('invalid JSON');
  });
  it('read-only tests both endpoints and closes both clients', async () => {
    expect((await testCloudConnections({ primaryUrl: primary, fallbackUrl: backup })).ok).toBe(true);
    expect(mocks.client.mock.calls.map(call => call[0])).toEqual([primary, backup]);
    expect(mocks.query.mock.calls).toEqual([['SELECT 1'], ['SELECT 1']]); expect(mocks.end).toHaveBeenCalledTimes(2);
  });
  it('test failures do not return database errors, credentials, or change stored values', async () => {
    mocks.query.mockRejectedValue(Error('password fixture at ' + primary));
    const result = await testCloudConnections({ primaryUrl: primary }); expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('fixture'); expect(cloudConnections().primaryUrl).toBe('');
  });
  it('a stalled connection test ends within the explicit timeout and releases its client', async () => {
    vi.useFakeTimers();
    try {
      mocks.query.mockImplementation(() => new Promise(() => {}));
      const pending = testCloudConnections({ primaryUrl: primary });
      await vi.advanceTimersByTimeAsync(8000);
      const result = await pending;
      expect(result.ok).toBe(false); expect(result.primary.error).toContain('超时');
      expect(result.primary.elapsedMs).toBeGreaterThanOrEqual(8000);
      expect(mocks.end).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('encrypted transfer round-trips two connections and rejects wrong passwords or tampering', () => {
    const connections = { primaryUrl: primary, fallbackUrl: backup };
    const envelope = encryptConnections(connections, 'transfer-fixture-password');
    expect(JSON.stringify(envelope)).not.toContain('primary.invalid');
    expect(decryptConnections(envelope, 'transfer-fixture-password')).toEqual(connections);
    expect(() => decryptConnections(envelope, 'different-password')).toThrow('口令不正确');
    expect(() => decryptConnections({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, 'transfer-fixture-password')).toThrow();
  });
});
