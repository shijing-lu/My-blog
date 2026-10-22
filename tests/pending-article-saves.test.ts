import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { articleContentVersion, flushPendingArticleSaves, pendingArticleField, registerArticleBaseline, rememberArticleSave, saveArticleSnapshot, setArticleContentVersion } from '../src/lib/pending-article-saves';
import { prefetchDocNode, takePrefetchedDocNode } from '../src/lib/doc-viewport';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe('silent article navigation saves', () => {
  it('clears an already-persisted recovery draft before a single window starts new edits', async () => {
    const url = '/api/articles/restored-matching';
    setArticleContentVersion(url, hash('old version'));
    rememberArticleSave(url, { content: 'already saved' });
    await registerArticleBaseline(url, 'already saved');
    expect(pendingArticleField(url, 'content')).toBeNull();
    expect(articleContentVersion(url)).toBe(hash('already saved'));
    const request = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      return body.expectedContentHash === hash('already saved')
        ? new Response(JSON.stringify({ contentHash: hash(body.content) }))
        : new Response('{}', { status: 409 });
    });
    vi.stubGlobal('fetch', request);
    await expect(saveArticleSnapshot(url, { content: 'new single-window edit' })).resolves.toBeDefined();
  });

  it('does not replace a freshly acknowledged local version with an older opening response', async () => {
    const url = '/api/articles/opening-race';
    setArticleContentVersion(url, hash('initial'));
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const saving = saveArticleSnapshot(url, { content: 'saved during opening' });
    const opening = registerArticleBaseline(url, 'initial');
    finish(new Response(JSON.stringify({ contentHash: hash('saved during opening') })));
    const [, loadedVersion] = await Promise.all([saving, opening]);
    expect(articleContentVersion(url)).toBe(hash('saved during opening'));
    expect(loadedVersion).toBe(hash('initial')); // The host can detect and reload the stale read.
  });

  it('invalidates an old document prefetch after a background pending save succeeds', async () => {
    const id = 'background-prefetch', url = '/api/doc/nodes/' + id;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => options?.method === 'PATCH'
      ? new Response(JSON.stringify({ contentHash: hash('saved draft') }))
      : new Response(JSON.stringify({ node: { content: 'old prefetched source' } }))));
    prefetchDocNode(id);
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 0));
    setArticleContentVersion(url, hash('old prefetched source'));
    await saveArticleSnapshot(url, { content: 'saved draft' });
    expect(takePrefetchedDocNode(id)).toBeUndefined();
  });

  it('retains the original version of a divergent recovery draft instead of overwriting the server', async () => {
    const url = '/api/articles/real-recovery-conflict';
    setArticleContentVersion(url, hash('shared base'));
    rememberArticleSave(url, { content: 'unsent draft' });
    await registerArticleBaseline(url, 'different server edit');
    expect(articleContentVersion(url)).toBe(hash('shared base'));
    expect(pendingArticleField(url, 'content')).toBe('unsent draft');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })));
    await expect(saveArticleSnapshot(url, { content: 'unsent draft' })).rejects.toThrow('当前改动已暂存');
    expect(pendingArticleField(url, 'content')).toBe('unsent draft');
  });
  it('shows the HTTP status and server reason while retaining a rejected snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '正文过长，未保存' }), { status: 413 })));
    await expect(saveArticleSnapshot('/api/articles/rejected', { content: 'retained' })).rejects.toThrow('HTTP 413');
    expect(pendingArticleField('/api/articles/rejected', 'content')).toBe('retained');
  });
  it('retains a failed save and retries it after navigation', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', request);
    await expect(saveArticleSnapshot('/api/articles/one', { content: 'latest' })).rejects.toThrow('网络连接失败，修改已暂存');
    expect(pendingArticleField('/api/articles/one', 'content')).toBe('latest');
    await flushPendingArticleSaves();
    expect(pendingArticleField('/api/articles/one', 'content')).toBeNull();
  });
  it('sends newer typing after an in-flight save instead of dropping it', async () => {
    let resolveFirst!: (response: Response) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; })).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', request);
    const first = saveArticleSnapshot('/api/articles/one', { content: 'old' });
    rememberArticleSave('/api/articles/one', { content: 'new' });
    resolveFirst(new Response('{}'));
    await first;
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({ content: 'new' });
    expect(pendingArticleField('/api/articles/one', 'content')).toBeNull();
  });
  it('preserves independent title and content snapshots for the same document', async () => {
    const request = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', request);
    rememberArticleSave('/api/doc/nodes/one', { title: 'Title' });
    rememberArticleSave('/api/doc/nodes/one', { content: 'Body' });
    await flushPendingArticleSaves(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
  });
  it('continues saving when browser storage is full', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const request = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', request);
    await saveArticleSnapshot('/api/articles/full-storage', { content: 'retained' });
    expect(request).toHaveBeenCalledOnce();
    expect(pendingArticleField('/api/articles/full-storage', 'content')).toBeNull();
  });
  it('correctly reports pending save status through hasPendingArticleSaves', async () => {
    const { hasPendingArticleSaves } = await import('../src/lib/pending-article-saves');
    expect(hasPendingArticleSaves()).toBe(false);
    rememberArticleSave('/api/articles/check-pending', { content: 'unsent' });
    expect(hasPendingArticleSaves()).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    await flushPendingArticleSaves();
    expect(hasPendingArticleSaves()).toBe(false);
  });
  it('overrides baseline and pending snapshot version to resolve 409 conflict', async () => {
    const { overrideArticleContentVersion } = await import('../src/lib/pending-article-saves');
    const url = '/api/articles/resolve-conflict';
    setArticleContentVersion(url, hash('stale-hash'));
    rememberArticleSave(url, { content: 'my local edits' });

    const request = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.expectedContentHash === hash('new-server-hash')) {
        return new Response(JSON.stringify({ contentHash: hash(body.content) }));
      }
      return new Response('{}', { status: 409 });
    });
    vi.stubGlobal('fetch', request);

    await expect(saveArticleSnapshot(url, { content: 'my local edits' })).rejects.toThrow('服务器正文版本已变化');

    overrideArticleContentVersion(url, hash('new-server-hash'));
    expect(articleContentVersion(url)).toBe(hash('new-server-hash'));

    await expect(saveArticleSnapshot(url, { content: 'my local edits' })).resolves.toBeDefined();
    expect(pendingArticleField(url, 'content')).toBeNull();
  });
});
