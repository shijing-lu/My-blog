/**
 * 自定义主题（运行时导入，无需改代码）
 *
 * 用户在设置面板导入「主题 JSON」（格式与 docs/THEME-DEV.md 一致）：
 * - 解析并校验（id 唯一性、必需令牌）；
 * - 存入 localStorage（键 `my-blog-custom-themes`），附带预生成的 CSS（`_css`），
 *   供 BaseLayout 的无闪烁脚本在首帧前直接注入；
 * - 运行时通过 `#custom-theme-css` <style> 生效，可删除。
 */
import { themeToCss, themes as builtinThemes } from '@/themes';
import type { ThemeDefinition, ThemeTokens } from '@/themes';
import { FONT_DISPLAY, FONT_PIXEL, FONT_SANS } from '@/themes/fonts';

/** 自定义主题在 localStorage 中的键 */
export const CUSTOM_THEMES_KEY = 'my-blog-custom-themes';

/** 存储形态：主题定义 + 预生成 CSS */
export interface StoredCustomTheme extends ThemeDefinition {
  /** 预生成 CSS（`html[data-theme='id']` 亮 + `.dark` 两段） */
  _css: string;
}

/** 解析结果 */
export type ParseResult = { ok: true; theme: ThemeDefinition } | { ok: false; error: string };

/** 必需颜色令牌（其余可缺省，见 parseTokens 兜底） */
const REQUIRED_TOKENS = ['background', 'foreground', 'card', 'primary', 'border'] as const;

/** 安全取字符串 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 解析并补齐一套令牌（缺失的可选令牌按主色/卡片色兜底）
 *
 * @param raw 用户 JSON 中的 light/dark
 * @returns 完整令牌或 null（必需令牌缺失）
 */
function parseTokens(raw: unknown): ThemeTokens | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  for (const key of REQUIRED_TOKENS) {
    if (!str(t[key])) return null;
  }
  return {
    background: str(t.background),
    foreground: str(t.foreground),
    card: str(t.card),
    cardForeground: str(t.cardForeground) || str(t.foreground),
    popover: str(t.popover) || str(t.card),
    popoverForeground: str(t.popoverForeground) || str(t.foreground),
    primary: str(t.primary),
    primaryForeground: str(t.primaryForeground) || '#ffffff',
    secondary: str(t.secondary) || str(t.card),
    secondaryForeground: str(t.secondaryForeground) || str(t.foreground),
    muted: str(t.muted) || str(t.card),
    mutedForeground: str(t.mutedForeground) || str(t.foreground),
    accent: str(t.accent) || str(t.card),
    accentForeground: str(t.accentForeground) || str(t.foreground),
    destructive: str(t.destructive) || '#c0362c',
    border: str(t.border),
    input: str(t.input) || str(t.border),
    ring: str(t.ring) || str(t.primary),
    fontSans: str(t.fontSans) || FONT_SANS,
    fontDisplay: str(t.fontDisplay) || FONT_DISPLAY,
    fontPixel: str(t.fontPixel) || FONT_PIXEL,
    radius: str(t.radius) || '0.75rem',
  };
}

/**
 * 解析用户导入的主题 JSON
 *
 * @param text JSON 文本
 * @returns 校验通过的主题或错误信息
 */
export function parseThemeJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 解析失败：不是合法的 JSON。' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: '主题必须是 JSON 对象。' };
  }
  const d = data as Record<string, unknown>;
  const id = str(d.id);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return { ok: false, error: 'id 只能包含小写字母、数字、连字符（如 my-theme）。' };
  }
  if (builtinThemes.some((t) => t.id === id)) {
    return { ok: false, error: `id「${id}」与内置主题冲突，请换一个。` };
  }
  const light = parseTokens(d.light);
  if (!light) {
    return { ok: false, error: 'light 令牌缺失或非法（至少需要 background/foreground/card/primary/border）。' };
  }
  const dark = parseTokens(d.dark);
  if (!dark) {
    return { ok: false, error: 'dark 令牌缺失或非法。' };
  }
  const previewRaw = Array.isArray(d.preview) ? d.preview : [light.background, light.primary, light.secondary];
  const preview = previewRaw
    .slice(0, 3)
    .map((c) => (typeof c === 'string' ? c : light.primary)) as [string, string, string];

  return {
    ok: true,
    theme: { id, name: str(d.name) || id, description: str(d.description) || '自定义主题', light, dark, preview },
  };
}

/** 读取全部自定义主题 */
export function getCustomThemes(): StoredCustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredCustomTheme[]) : [];
  } catch {
    return [];
  }
}

/** 覆盖保存自定义主题列表 */
export function saveCustomThemes(list: StoredCustomTheme[]): void {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 新增/覆盖一个自定义主题（生成 _css 并持久化），返回最新列表 */
export function addCustomTheme(theme: ThemeDefinition): StoredCustomTheme[] {
  const stored: StoredCustomTheme = { ...theme, _css: themeToCss(theme) };
  const next = [...getCustomThemes().filter((t) => t.id !== theme.id), stored];
  saveCustomThemes(next);
  return next;
}

/** 删除一个自定义主题，返回最新列表 */
export function removeCustomTheme(id: string): StoredCustomTheme[] {
  const next = getCustomThemes().filter((t) => t.id !== id);
  saveCustomThemes(next);
  return next;
}

/** 将主题 CSS 注入/更新到 #custom-theme-css（运行时切换用） */
export function injectCustomThemeCss(theme: ThemeDefinition | StoredCustomTheme): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('custom-theme-css') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'custom-theme-css';
    document.head.appendChild(el);
  }
  el.textContent = '_css' in theme ? theme._css : themeToCss(theme);
}

/** 移除已注入的自定义主题 CSS */
export function clearCustomThemeCss(): void {
  if (typeof document === 'undefined') return;
  document.getElementById('custom-theme-css')?.remove();
}
