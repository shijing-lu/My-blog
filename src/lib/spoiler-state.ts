/** Device-only preferences. Keys contain fingerprints, never spoiler plaintext. */
export function spoilerFingerprint(content: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < content.length; i++) { a = Math.imul(a ^ content.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ content.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
const memory = new Map<string, Record<string, boolean>>();
const memoryOnly = new Set<string>();
const PREFIX = 'byqx-spoiler-items-v1:';
export function spoilerStates(article: string): Record<string, boolean> {
  if (memoryOnly.has(article)) return memory.get(article) ?? {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFIX + article) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const states = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => /^[a-f0-9]+:\d+$/.test(key) && typeof value === 'boolean')) as Record<string, boolean>;
      memory.set(article, states); return states;
    }
  } catch {}
  return memory.get(article) ?? {};
}
export function rememberSpoiler(article: string, item: string, open: boolean): void {
  const state = { ...spoilerStates(article), [item]: open };
  memory.set(article, state);
  try { localStorage.setItem(PREFIX + article, JSON.stringify(state)); } catch { memoryOnly.add(article); }
}
