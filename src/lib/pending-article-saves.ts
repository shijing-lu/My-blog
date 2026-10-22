/** Retain unsent editor snapshots across navigation; send each field in order. */
import { invalidatePrefetchedDocNode } from './doc-viewport';
const PREFIX = 'byqx:pending-article:';
const active = new Map<string, Promise<unknown>>();
const volatile = new Map<string, string>();
const baselines = new Map<string,string>();
export function setArticleContentVersion(url: string, hash: string): void { baselines.set(url,hash); }
export function articleContentVersion(url: string): string | undefined { return baselines.get(url); }
/** 覆盖某文档的基准版本，若存在排队/冲突的暂存记录，将其期望哈希同步更新为最新服务端哈希 */
export function overrideArticleContentVersion(url: string, newHash: string): void {
  baselines.set(url, newHash);
  const key = keyFor(url, { content: '' });
  const pending = read(key);
  if (pending) {
    pending.body.expectedContentHash = newHash;
    const value = JSON.stringify(pending);
    volatile.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* Storage may be full */ }
  }
}
/** Return the version of the supplied read, which may differ from a concurrent save acknowledgement. */
export async function registerArticleBaseline(url: string, source: string): Promise<string> {
  const previousVersion = baselines.get(url);
  let version: string;
  if(crypto.subtle) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
    version = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  } else {
    const response=await fetch(url,{cache:'no-store'}),data=await response.json();
    if(!response.ok||typeof data.contentHash!=='string')throw new Error('无法读取正文版本');
    version = data.contentHash;
  }
  // A recovered draft may already be on the server (e.g. its acknowledgement
  // was lost). Reusing that draft's older hash makes the next local edit conflict.
  const pending = read(keyFor(url, { content: '' }));
  if (pending?.body.content === source) discardArticleField(url, 'content');
  else if (pending?.body.expectedContentHash) {
    baselines.set(url, pending.body.expectedContentHash);
    return version;
  }
  // Hashing/loading must not rewind an acknowledgement from this same window.
  if (baselines.get(url) === previousVersion) baselines.set(url, version);
  return version;
}
interface PendingSave { url: string; body: Record<string, string>; }
function keyFor(url: string, body: Record<string, string>): string {
  return PREFIX + url + ':' + Object.keys(body).filter(k=>k!=='expectedContentHash').sort().join(',');
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
  if('content' in body && baselines.has(url)) body={...body,expectedContentHash:baselines.get(url)!};
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
      let response: Response;
      try {
        response = await fetch(item.url, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body,
          keepalive: keepalive && new TextEncoder().encode(body).length < 60000,
          signal: AbortSignal.timeout(15000),
        });
      } catch (cause) {
        throw new Error(cause instanceof Error && cause.name === 'TimeoutError' ? '保存超时，修改已暂存，请重试' : '网络连接失败，修改已暂存，请重试');
      }
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: unknown };
        throw new Error(response.status === 409 ? '服务器正文版本已变化，当前改动已暂存，请处理冲突后再保存' : response.status === 401 || response.status === 403 ? '登录已过期，重新登录后会继续自动保存' : `自动保存失败（HTTP ${response.status}）：${typeof failure.error === 'string' ? failure.error : '服务器暂时不可用'}；修改已暂存，请重试`);
      }
      result = await response.json().catch(() => ({}));
      const hash=(result as {contentHash?:string}).contentHash;
      if(hash&&'content' in item.body) {
        baselines.set(item.url,hash);
        const nodeId = item.url.match(/^\/api\/doc\/nodes\/([^/]+)$/)?.[1];
        if (nodeId) invalidatePrefetchedDocNode(nodeId);
        if(storedValue(key)!==stored) {
          const latest=read(key);
          if(latest) { const value=JSON.stringify({...latest,body:{...latest.body,expectedContentHash:hash}});volatile.set(key,value);try{localStorage.setItem(key,value);}catch{/* memory fallback */} }
        }
      }
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

export function hasPendingArticleSaves(): boolean {
  if (volatile.size > 0 || active.size > 0) return true;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) return true;
    }
  } catch { /* Storage unavailable */ }
  return false;
}

if (typeof window !== 'undefined') {
  window.setInterval(() => { void flushPendingArticleSaves(); }, 3000);
  window.addEventListener('pagehide', () => { void flushPendingArticleSaves(true); });
  window.addEventListener('beforeunload', (e) => {
    if (hasPendingArticleSaves()) {
      void flushPendingArticleSaves(true);
      e.preventDefault();
      Object.assign(e, { returnValue: '' });
    }
  });
  document.addEventListener('astro:before-preparation', () => { void flushPendingArticleSaves(true); });
  document.addEventListener('astro:page-load', () => { void flushPendingArticleSaves(); });
}
