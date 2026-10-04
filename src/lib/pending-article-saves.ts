/** Retain unsent editor snapshots across navigation; send each field in order. */
const PREFIX = 'byqx:pending-article:';
const active = new Map<string, Promise<unknown>>();
const volatile = new Map<string, string>();
interface PendingSave { url: string; body: Record<string, string>; }
function keyFor(url: string, body: Record<string, string>): string {
  return PREFIX + url + ':' + Object.keys(body).sort().join(',');
}
function storedValue(key: string): string | null {
  if (volatile.has(key)) return volatile.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}
function read(key: string): PendingSave | null {
  try {
    const item = JSON.parse(storedValue(key) || 'null') as PendingSave | null;
    return item && /^\/api\/(?:articles|doc\/nodes)\/[^/]+(?:\/title)?$/.test(item.url) ? item : null;
  } catch { return null; }
}
export function rememberArticleSave(url: string, body: Record<string, string>): void {
  const key = keyFor(url, body);
  const value = JSON.stringify({ url, body });
  volatile.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* Storage may be full; typing and in-page saving still work. */ }
}
export function discardArticleField(url: string, field: string): void {
  const key = keyFor(url, { [field]: '' });
  volatile.delete(key);
  try { localStorage.removeItem(key); } catch { /* Memory fallback remains available. */ }
}
export function pendingArticleField(url: string, field: string): string | null {
  return read(keyFor(url, { [field]: '' }))?.body[field] ?? null;
}
async function send(key: string, keepalive = false): Promise<unknown> {
  const running = active.get(key);
  if (running) return running;
  const task = (async () => {
    let result: unknown;
    for (let item = read(key); item; item = read(key)) {
      const stored = storedValue(key);
      const body = JSON.stringify(item.body);
      const response = await fetch(item.url, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body,
        keepalive: keepalive && new TextEncoder().encode(body).length < 60000,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '登录已过期，重新登录后会继续自动保存' : '自动保存暂时失败，修改已暂存并会重试');
      result = await response.json().catch(() => ({}));
      if (storedValue(key) === stored) {
        volatile.delete(key);
        try { localStorage.removeItem(key); } catch { /* Already saved successfully. */ }
      }
    }
    return result;
  })();
  active.set(key, task);
  try { return await task; }
  finally { active.delete(key); }
}
export async function saveArticleSnapshot(url: string, body: Record<string, string>): Promise<unknown> {
  rememberArticleSave(url, body);
  return send(keyFor(url, body));
}
export async function flushPendingArticleSaves(keepalive = false): Promise<void> {
  const keys = new Set(volatile.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.add(key);
    }
  } catch { /* Use memory snapshots when browser storage is unavailable. */ }
  await Promise.allSettled([...keys].map(key => send(key, keepalive)));
}

if (typeof window !== 'undefined') {
  window.setInterval(() => { void flushPendingArticleSaves(); }, 3000);
  window.addEventListener('pagehide', () => { void flushPendingArticleSaves(true); });
  document.addEventListener('astro:before-preparation', () => { void flushPendingArticleSaves(true); });
  document.addEventListener('astro:page-load', () => { void flushPendingArticleSaves(); });
}
