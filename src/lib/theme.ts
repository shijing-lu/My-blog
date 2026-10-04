/**
 * 客户端主题状态管理
 *
 * 状态形如 `{ themeId: string; mode: 'light'|'dark'|'system' }`，持久化于
 * localStorage 键 `my-blog-theme`。`themeId=''` 表示默认主题（不设 data-theme，
 * 回落 :root 默认），`mode` 控制亮/暗/跟随系统。
 */

/** 外观模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 主题状态 */
export interface ThemeState {
  /** 主题 id；空串 = 默认主题 */
  themeId: string;
  /** 亮/暗/跟随系统 */
  mode: ThemeMode;
}

/** 默认状态 */
export const DEFAULT_STATE: ThemeState = { themeId: '', mode: 'system' };

/** localStorage 键 */
export const THEME_STORAGE_KEY = 'my-blog-theme';
let transientState: ThemeState | undefined;

/** 读取当前状态（非法/缺失回落到默认） */
export function readState(): ThemeState {
  if (transientState) return transientState;
  if (typeof localStorage === 'undefined') return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const p = JSON.parse(raw) as Partial<ThemeState>;
    const mode: ThemeMode =
      p.mode === 'light' || p.mode === 'dark' || p.mode === 'system' ? p.mode : 'system';
    return { themeId: typeof p.themeId === 'string' ? p.themeId : '', mode };
  } catch {
    return DEFAULT_STATE;
  }
}

/** 系统是否偏好暗色 */
export function systemDark(): boolean {
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** 依据状态判断当前是否需要暗色 */
export function isDark(state: ThemeState): boolean {
  return state.mode === 'dark' || (state.mode === 'system' && systemDark());
}

/** 将状态应用到 <html>（data-theme + .dark + data-mode） */
function applyStateImmediately(state: ThemeState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (state.themeId) root.setAttribute('data-theme', state.themeId);
  else root.removeAttribute('data-theme');
  root.classList.toggle('dark', isDark(state));
  root.setAttribute('data-mode', state.mode);
}

export interface ThemeTransitionOptions {
  /** 转场圆心；未提供时使用屏幕中心。 */
  origin?: { x: number; y: number };
}

type ThemeTransition = Pick<ViewTransition, 'ready' | 'finished' | 'updateCallbackDone' | 'skipTransition'>;
let sequence = 0;
let navigating = false;
let motionBound = false;
let active: { transition: ThemeTransition; cleanup: () => void } | null = null;

/** 取消的是本模块拥有的转场，绝不跳过 Astro 路由转场。 */
function stopThemeMotion(): void {
  sequence += 1;
  const previous = active;
  active = null;
  previous?.transition.skipTransition();
  previous?.cleanup();
}

function bindThemeMotion(): void {
  if (motionBound) return;
  motionBound = true;
  let navigation = 0;
  document.addEventListener('astro:before-preparation', (event) => {
    const version = ++navigation;
    navigating = true;
    stopThemeMotion();
    applyStateImmediately(readState());
    (event as Event & { signal?: AbortSignal }).signal?.addEventListener('abort', () => {
      if (navigation === version) navigating = false;
    }, { once: true });
  });
  document.addEventListener('astro:page-load', () => { navigating = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopThemeMotion(); applyStateImmediately(readState()); }
  });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    if (event.matches) { stopThemeMotion(); applyStateImmediately(readState()); }
  });
}

/** 首次恢复不动画；用户主动选择时增强，快速连点始终以最后选择为准。 */
function transitionThemeState(state: ThemeState, options?: ThemeTransitionOptions): void {
  if (typeof document === 'undefined') return;
  bindThemeMotion();
  const root = document.documentElement;
  const busy = active !== null;
  stopThemeMotion();
  const id = sequence;
  const unchanged = (root.dataset.theme ?? '') === state.themeId && root.classList.contains('dark') === isDark(state);
  const nativeActive = (document as Document & { activeViewTransition?: unknown }).activeViewTransition;
  if (unchanged || busy || navigating || nativeActive || !options || document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition) {
    applyStateImmediately(state);
    return;
  }
  const point = options.origin ?? { x: innerWidth / 2, y: innerHeight / 2 };
  const x = Math.max(0, Math.min(innerWidth, point.x));
  const y = Math.max(0, Math.min(innerHeight, point.y));
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const properties = ['--motion-origin-x', '--motion-origin-y', '--motion-origin-radius'];
  const previous = properties.map((name) => root.style.getPropertyValue(name));
  [x, y, radius].forEach((value, i) => root.style.setProperty(properties[i]!, value + 'px'));
  root.dataset.themeTransition = 'active';
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    properties.forEach((name, i) => root.style.setProperty(name, previous[i]!));
    delete root.dataset.themeTransition;
    if (active?.cleanup === cleanup) active = null;
  };
  try {
    const transition = document.startViewTransition(() => {
      if (sequence === id) applyStateImmediately(state);
    });
    active = { transition, cleanup };
    // 被新交互/导航跳过时 ready 会拒绝，但业务更新不能因此被取消或重放。
    void transition.ready.catch(() => {});
    void transition.updateCallbackDone.catch(() => {
      if (sequence === id) applyStateImmediately(state);
    });
    void transition.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    if (sequence === id) applyStateImmediately(state);
  }
}

/** 持久化并应用；主题改变不等待动画完成即可继续交互。 */
export function writeState(state: ThemeState, options?: ThemeTransitionOptions): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
    transientState = undefined;
  } catch {
    transientState = { ...state };
  }
  transitionThemeState(state, options);
}

/** 立即同步 DOM，不播放动效（用于首次加载、路由恢复与系统设置变化）。 */
export function applyState(state: ThemeState): void {
  if (typeof document !== 'undefined') bindThemeMotion();
  stopThemeMotion();
  applyStateImmediately(state);
}

/**
 * 恢复主题状态到 <html>（View Transition 导航后调用）
 *
 * 仅应用 data-theme / .dark / data-mode；不注入自定义主题 CSS——
 * 自定义主题 CSS 由调用方（BaseLayout）在恢复时同步注入，避免循环依赖。
 */
export function restoreTheme(): void {
  applyState(readState());
}

/** 防止重复注册（每次 astro:page-load 都会调用） */
let systemWatcherReady = false;

/**
 * 跟随系统明暗偏好（此前缺失：mode='system' 下系统切换主题不会实时响应）
 *
 * 监听器挂在 matchMedia 上（不随 DOM 替换失效），只需注册一次。
 */
export function initSystemThemeWatcher(): void {
  if (systemWatcherReady || typeof matchMedia === 'undefined') return;
  systemWatcherReady = true;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', () => {
    const state = readState();
    if (state.mode !== 'system') return;
    applyState(state); // 即时应用（系统主题跟随不做过渡）
  });
}
