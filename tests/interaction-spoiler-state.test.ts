import { afterEach, expect, it, vi } from 'vitest';
import { rememberSpoiler, spoilerFingerprint, spoilerStates } from '../src/lib/spoiler-state';
afterEach(() => vi.unstubAllGlobals());
it('stores article-isolated identities without storing spoiler content', () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  const key = spoilerFingerprint('private-answer-42') + ':0';
  rememberSpoiler('a', key, true); expect(spoilerStates('a')[key]).toBe(true); expect(spoilerStates('b')[key]).toBeUndefined();
  expect([...data.values()].join()).not.toContain('private-answer-42');
  rememberSpoiler('a', key, false); expect(spoilerStates('a')[key]).toBe(false);
  expect(spoilerStates('a')[spoilerFingerprint('changed-answer') + ':0']).toBeUndefined();
});
it('keeps memory state when local storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
  rememberSpoiler('fallback', 'abcd:1', true); expect(spoilerStates('fallback')['abcd:1']).toBe(true);
});
it('keeps memory state after a quota write failure even when reads still succeed', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{}', setItem: () => { throw Error('quota'); } });
  rememberSpoiler('quota', 'abcd:0', true); expect(spoilerStates('quota')['abcd:0']).toBe(true);
});
