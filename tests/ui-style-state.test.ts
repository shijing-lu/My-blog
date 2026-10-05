import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeUiStylePreference, resolveUiStyle } from '../src/lib/ui-style';

function makeDocument(siteStyle = 'classic') {
  const classes = new Set<string>();
  const root = {
    dataset: { siteUiStyle: siteStyle } as Record<string, string>,
    classList: { contains: (key: string) => classes.has(key), toggle: (key: string, enabled: boolean) => enabled ? classes.add(key) : classes.delete(key) },
    setAttribute(key: string, value: string) { this.dataset[key.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value; },
    removeAttribute(key: string) { delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())]; },
  };
  const attributes = new Map<string, string>();
  const legacySheet = {
    media: 'screen',
    hasAttribute: (key: string) => attributes.has(key),
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => attributes.set(key, value),
  };
  const doc = Object.assign(new EventTarget(), { documentElement: root, hidden: false, querySelectorAll: () => [legacySheet] });
  return { doc, root, legacySheet };
}

describe('Material style preferences', () => {
  it.each([
    ['inherit', 'material3', 'material3'], ['inherit', 'classic', 'classic'],
    ['classic', 'material3', 'classic'], ['material3', 'classic', 'material3'],
    [undefined, undefined, 'classic'], ['invalid', 'material3', 'material3'],
  ])('resolves %s over site %s to %s', (device, site, expected) => {
    expect(resolveUiStyle(device, site)).toBe(expected);
  });
  it('invalid and absent device preferences inherit', () => {
    expect(normalizeUiStylePreference(undefined)).toBe('inherit');
    expect(normalizeUiStylePreference('unexpected')).toBe('inherit');
  });
});

describe('theme state and document application', () => {
  let surface: ReturnType<typeof makeDocument>;
  let storage: Map<string, string>;
  let windowTarget: EventTarget;
  let darkPreference: EventTarget & { matches: boolean };
  beforeEach(() => {
    vi.resetModules();
    surface = makeDocument('material3');
    storage = new Map();
    darkPreference = Object.assign(new EventTarget(), { matches: false });
    const matchMedia = (query: string) => query.includes('reduced-motion') ? Object.assign(new EventTarget(), { matches: false }) : darkPreference;
    windowTarget = Object.assign(new EventTarget(), { matchMedia });
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', surface.doc);
    vi.stubGlobal('matchMedia', matchMedia);
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ defaultStyle: 'material3' }))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('restores legacy preferences without opting existing sites into Material', async () => {
    storage.set('my-blog-theme', JSON.stringify({ themeId: 'graphite', mode: 'dark' }));
    const theme = await import('../src/lib/theme');
    expect(theme.readState()).toEqual({ themeId: 'graphite', mode: 'dark', uiStyle: 'inherit' });
    const incoming = makeDocument('classic');
    theme.applyThemeToDocument(incoming.doc as unknown as Document);
    expect(incoming.root.dataset.uiStyle).toBe('classic');
    expect(incoming.root.dataset.theme).toBe('graphite');
    expect(incoming.root.classList.contains('dark')).toBe(true);
  });

  it('disables legacy styles in Material and restores original media and theme', async () => {
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: 'terminal', mode: 'light', uiStyle: 'material3' });
    expect(surface.root.dataset.uiStyle).toBe('material3');
    expect(surface.root.dataset.theme).toBeUndefined();
    expect(surface.legacySheet.media).toBe('not all');
    expect(theme.readState().themeId).toBe('terminal');
    theme.writeState({ ...theme.readState(), uiStyle: 'classic' });
    expect(surface.root.dataset.theme).toBe('terminal');
    expect(surface.legacySheet.media).toBe('screen');
  });

  it('storage denied still keeps preferences through a navigation restore', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: 'graphite', mode: 'dark', uiStyle: 'classic' });
    const incoming = makeDocument('material3');
    theme.applyThemeToDocument(incoming.doc as unknown as Document);
    expect(incoming.root.dataset.uiStyle).toBe('classic');
    expect(incoming.root.dataset.theme).toBe('graphite');
    expect(incoming.root.classList.contains('dark')).toBe(true);
  });

  it('cross-tab device changes and system dark changes apply immediately', async () => {
    const theme = await import('../src/lib/theme');
    theme.initSystemThemeWatcher();
    storage.set('my-blog-theme', JSON.stringify({ themeId: 'terminal', mode: 'system', uiStyle: 'classic' }));
    windowTarget.dispatchEvent(Object.assign(new Event('storage'), { key: theme.THEME_STORAGE_KEY }));
    expect(surface.root.dataset.uiStyle).toBe('classic');
    darkPreference.matches = true;
    darkPreference.dispatchEvent(new Event('change'));
    expect(surface.root.classList.contains('dark')).toBe(true);
  });

  it('default refresh does not override an explicit device choice and emits shared event', async () => {
    const theme = await import('../src/lib/theme');
    const listener = vi.fn();
    windowTarget.addEventListener('byqx:theme-change', listener);
    theme.writeState({ themeId: '', mode: 'light', uiStyle: 'classic' });
    await theme.refreshSiteUiStyle();
    expect(surface.root.dataset.siteUiStyle).toBe('material3');
    expect(surface.root.dataset.uiStyle).toBe('classic');
    expect(listener).toHaveBeenCalled();
  });

  it('failed refresh retains server default', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('unavailable', { status: 500 }));
    const theme = await import('../src/lib/theme');
    await theme.refreshSiteUiStyle();
    expect(surface.root.dataset.siteUiStyle).toBe('material3');
  });

  it('a stale GET cannot undo a successful admin save', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const theme = await import('../src/lib/theme');
    const request = theme.refreshSiteUiStyle();
    theme.setSiteUiStyle('classic', true);
    finish(new Response(JSON.stringify({ defaultStyle: 'material3' })));
    await request;
    expect(surface.root.dataset.siteUiStyle).toBe('classic');
    expect(surface.root.dataset.uiStyle).toBe('classic');
    expect(storage.has(theme.SITE_STYLE_SIGNAL_KEY)).toBe(true);
  });
});
