/**
 * 自定义主题 JSON 导入校验单元测试
 */
import { describe, expect, it } from 'vitest';
import { parseThemeJson } from '../src/lib/custom-theme';

/** 构造最小合法主题 JSON 字符串 */
function minimalTheme(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'test-theme',
    name: '测试主题',
    light: { background: '#fff', foreground: '#000', card: '#fff', primary: '#123456', border: '#ccc' },
    dark: { background: '#000', foreground: '#fff', card: '#111', primary: '#654321', border: '#222' },
    ...overrides,
  });
}

describe('parseThemeJson', () => {
  it('接受最小合法主题并补齐缺省令牌', () => {
    const r = parseThemeJson(minimalTheme());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.theme.id).toBe('test-theme');
      expect(r.theme.light.fontSans.length).toBeGreaterThan(0);
      expect(r.theme.dark.radius).toBe('0.75rem');
    }
  });

  it('拒绝非法 JSON', () => {
    expect(parseThemeJson('{oops').ok).toBe(false);
  });

  it('拒绝与内置主题冲突的 id', () => {
    expect(parseThemeJson(minimalTheme({ id: 'claude-pixel' })).ok).toBe(false);
  });

  it('拒绝缺失必需令牌', () => {
    const bad = JSON.stringify({
      id: 'test-theme',
      light: { background: '#fff' },
      dark: { background: '#000' },
    });
    expect(parseThemeJson(bad).ok).toBe(false);
  });
});
