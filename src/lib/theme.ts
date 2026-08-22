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

/** 读取当前状态（非法/缺失回落到默认） */
export function readState(): ThemeState {
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
export function applyState(state: ThemeState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (state.themeId) root.setAttribute('data-theme', state.themeId);
  else root.removeAttribute('data-theme');
  root.classList.toggle('dark', isDark(state));
  root.setAttribute('data-mode', state.mode);
}

/** 持久化并立即应用 */
export function writeState(state: ThemeState): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式等场景忽略 */
  }
  applyState(state);
}
