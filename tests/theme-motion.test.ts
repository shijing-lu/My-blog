import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('主题动效的业务状态与取消', () => {
  let root: {
    dataset: Record<string, string>;
    classList: { contains: (key: string) => boolean; toggle: (key: string, value: boolean) => void };
    style: { getPropertyValue: (key: string) => string; setProperty: (key: string, value: string) => void };
    setAttribute: (key: string, value: string) => void;
    removeAttribute: (key: string) => void;
  };
  let doc: EventTarget & { documentElement: typeof root; hidden: boolean; startViewTransition?: ReturnType<typeof vi.fn> };
  let preference: EventTarget & { matches: boolean };
  let callbacks: Array<() => void>;
  let finishes: Array<() => void>;
  let skips: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    const classes = new Set<string>();
    const styles = new Map<string, string>();
    root = {
      dataset: {},
      classList: { contains: (key) => classes.has(key), toggle: (key, value) => { if (value) classes.add(key); else classes.delete(key); } },
      style: { getPropertyValue: (key) => styles.get(key) ?? '', setProperty: (key, value) => { styles.set(key, value); } },
      setAttribute: (key, value) => { root.dataset[key.slice(5)] = value; },
      removeAttribute: (key) => { delete root.dataset[key.slice(5)]; },
    };
    callbacks = []; finishes = []; skips = vi.fn();
    doc = Object.assign(new EventTarget(), { documentElement: root, hidden: false });
    doc.startViewTransition = vi.fn((update: () => void) => {
      const done = deferred(); const updated = deferred();
      callbacks.push(() => { update(); updated.resolve(); });
      finishes.push(done.resolve);
      return { ready: Promise.resolve(), finished: done.promise, updateCallbackDone: updated.promise, skipTransition: skips };
    });
    preference = Object.assign(new EventTarget(), { matches: false });
    const media = (query: string) => query.includes('reduced-motion') ? preference : { matches: false };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { matchMedia: media });
    vi.stubGlobal('matchMedia', media);
    vi.stubGlobal('innerWidth', 1200);
    vi.stubGlobal('innerHeight', 800);
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('不支持 API 时同步切换，主题持久化正常', async () => {
    doc.startViewTransition = undefined;
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: 'graphite', mode: 'dark' }, { origin: { x: 10, y: 10 } });
    expect(root.classList.contains('dark')).toBe(true);
    expect(theme.readState()).toEqual({ themeId: 'graphite', mode: 'dark' });
  });

  it('减少动效与程序恢复不创建快照', async () => {
    const theme = await import('../src/lib/theme');
    preference.matches = true;
    theme.writeState({ themeId: '', mode: 'dark' }, {});
    theme.applyState({ themeId: '', mode: 'light' });
    expect(doc.startViewTransition).not.toHaveBeenCalled();
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('快速连点后迟到的旧 callback 不能覆盖新选择', async () => {
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: 'graphite', mode: 'dark' }, {});
    theme.writeState({ themeId: 'terminal', mode: 'light' }, {});
    callbacks[0]!();
    expect(skips).toHaveBeenCalledOnce();
    expect(root.dataset.theme).toBe('terminal');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.themeTransition).toBeUndefined();
  });

  it('旧 finished 不能清除新转场的坐标和标记', async () => {
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: '', mode: 'dark' }, {});
    theme.writeState({ themeId: '', mode: 'light' }, {});
    theme.writeState({ themeId: '', mode: 'dark' }, { origin: { x: 77, y: 88 } });
    finishes[0]!();
    await Promise.resolve();
    expect(root.dataset.themeTransition).toBe('active');
    expect(root.style.getPropertyValue('--motion-origin-x')).toBe('77px');
    callbacks[1]!(); finishes[1]!();
    await Promise.resolve();
    expect(root.dataset.themeTransition).toBeUndefined();
  });

  it('导航期间跳过主题转场并废弃未执行的旧更新', async () => {
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: '', mode: 'dark' }, {});
    doc.dispatchEvent(new Event('astro:before-preparation'));
    theme.writeState({ themeId: 'cream-minimal', mode: 'light' }, {});
    callbacks[0]!();
    expect(doc.startViewTransition).toHaveBeenCalledOnce();
    expect(root.dataset.theme).toBe('cream-minimal');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('运行中启用减少动效：结束动画并保留已选状态', async () => {
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: '', mode: 'dark' }, {});
    preference.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    callbacks[0]!();
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.themeTransition).toBeUndefined();
  });

  it('已选主题再次点击不创建快照；API 同步报错仍可切换', async () => {
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: '', mode: 'light' }, {});
    expect(doc.startViewTransition).not.toHaveBeenCalled();
    doc.startViewTransition!.mockImplementation(() => { throw Error('unsupported'); });
    theme.writeState({ themeId: '', mode: 'dark' }, {});
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.themeTransition).toBeUndefined();
  });

  it('存储写入被拒绝时，连点和取消仍保留本次选择', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw Error('private mode'); } });
    const theme = await import('../src/lib/theme');
    theme.writeState({ themeId: 'terminal', mode: 'dark' }, {});
    doc.dispatchEvent(new Event('astro:before-preparation'));
    expect(theme.readState()).toEqual({ themeId: 'terminal', mode: 'dark' });
    expect(root.classList.contains('dark')).toBe(true);
  });
});
