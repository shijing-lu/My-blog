import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { readSyncState } = createRequire(import.meta.url)('../desktop/sync-request.cjs');

describe('desktop sync state requests', () => {
  it('recovers a finished background task after a transient network failure', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(new Response(JSON.stringify({ running: false, lastReport: { ok: true } })));
    const state = await readSyncState('http://127.0.0.1/sync', 'admin_session=fixture', { fetchFn, retryDelayMs: 0 });
    expect(state.lastReport.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]![1].headers.cookie).toBe('admin_session=fixture');
  });
  it('stops retrying when the session expired', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(readSyncState('http://127.0.0.1/sync', '', { fetchFn })).rejects.toThrow('重新登录');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('bounds retries without reporting a background task as failed', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    await expect(readSyncState('http://127.0.0.1/sync', '', { fetchFn, retries: 1, retryDelayMs: 0 })).rejects.toThrow('后台同步可能仍在执行');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('places a timeout signal on each state request', async () => {
    const fetchFn = vi.fn(async (_url, options) => {
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    });
    // Keep the loop alive while AbortSignal.timeout's unref'ed timer fires.
    const hold = setInterval(() => {}, 1000);
    try {
      await expect(readSyncState('http://127.0.0.1/sync', '', { fetchFn, timeoutMs: 5, retries: 0 })).rejects.toThrow('后台同步可能仍在执行');
    } finally { clearInterval(hold); }
  });
});
