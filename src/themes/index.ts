/**
 * 主题注册表
 *
 * - 汇集全部内置主题；
 * - `buildThemeCss()` 生成各主题的 CSS（`html[data-theme='id']` 覆盖 :root 默认）。
 * 新增主题：新建 `src/themes/<id>/index.ts`，在此 import 并加入 `themes` 数组。
 */
import type { ThemeDefinition, ThemeTokens } from './types';
import claudePixel from './claude-pixel';
import terminal from './terminal';
import creamMinimal from './cream-minimal';
import graphite from './graphite';

/** 全部内置主题（按 order 升序） */
export const themes: ThemeDefinition[] = [claudePixel, terminal, creamMinimal, graphite].sort(
  (a, b) => (a.order ?? 0) - (b.order ?? 0),
);

/** 默认主题 id */
export const DEFAULT_THEME_ID = claudePixel.id;

/** 令牌 → CSS 变量名 映射 */
const TOKEN_VAR: Record<keyof ThemeTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  border: '--border',
  input: '--input',
  ring: '--ring',
  fontSans: '--font-sans-family',
  fontDisplay: '--font-display-family',
  fontPixel: '--font-pixel-family',
  radius: '--radius',
  glow: '--theme-glow',
};

/** 将一套令牌转成 CSS 变量声明串 */
function tokensToCss(tokens: ThemeTokens): string {
  const parts = Object.keys(TOKEN_VAR)
    .filter((k): k is keyof ThemeTokens => k in tokens)
    .map((k) => {
      const value = tokens[k];
      if (value === undefined) return '';
      return `${TOKEN_VAR[k]}: ${value};`;
    });
  if (tokens.glow) parts.push('--theme-glow: 1;');
  return parts.join(' ');
}

/**
 * 生成全部主题的 CSS
 *
 * @returns 可直接作为 <style> 内容的字符串
 */
export function buildThemeCss(): string {
  return themes
    .map(
      (t) =>
        `html[data-theme='${t.id}'] { ${tokensToCss(t.light)} }` +
        `\nhtml[data-theme='${t.id}'].dark { ${tokensToCss(t.dark)} }`,
    )
    .join('\n');
}

/** 依据 id 查找主题（找不到返回 undefined） */
export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}

export type { ThemeDefinition, ThemeTokens } from './types';
