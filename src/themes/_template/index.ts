/**
 * 主题：示例模板（供开发手册复制）
 *
 * 复制本目录 → 改为你的主题 id → 填写亮/暗令牌 → 在 `../index.ts` 注册即可。
 * 开发手册见 docs/THEME-DEV.md。
 */
import type { ThemeDefinition } from '../types';
import { FONT_DISPLAY, FONT_SANS } from '../fonts';

/** 示例模板主题（不注册，仅作参考） */
const theme: ThemeDefinition = {
  id: 'your-theme-id',
  name: '你的主题名',
  description: '一句话描述',
  order: 99,
  light: {
    background: '#ffffff',
    foreground: '#141413',
    card: '#ffffff',
    cardForeground: '#141413',
    popover: '#ffffff',
    popoverForeground: '#141413',
    primary: '#d97757',
    primaryForeground: '#ffffff',
    secondary: '#f2f1ee',
    secondaryForeground: '#141413',
    muted: '#f2f1ee',
    mutedForeground: '#6f6a60',
    accent: '#f2f1ee',
    accentForeground: '#141413',
    destructive: '#c0362c',
    border: '#e3ddd1',
    input: '#e3ddd1',
    ring: '#d97757',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_SANS,
    radius: '0.75rem',
  },
  dark: {
    background: '#171514',
    foreground: '#ede7dc',
    card: '#1f1b18',
    cardForeground: '#ede7dc',
    popover: '#26211d',
    popoverForeground: '#ede7dc',
    primary: '#e08b6e',
    primaryForeground: '#0f0e0d',
    secondary: '#232019',
    secondaryForeground: '#ede7dc',
    muted: '#232019',
    mutedForeground: '#8a837a',
    accent: '#232019',
    accentForeground: '#ede7dc',
    destructive: '#e06a5a',
    border: '#2f291f',
    input: '#2f291f',
    ring: '#d97757',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_SANS,
    radius: '0.75rem',
  },
  preview: ['#ffffff', '#d97757', '#6b8f71'],
};

export default theme;
