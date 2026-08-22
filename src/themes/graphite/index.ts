/**
 * 主题：石墨蓝（科技感）
 *
 * 冷调蓝灰 + 钢蓝主色，等宽标签字，更方的圆角，偏工具/科技气质。
 */
import type { ThemeDefinition } from '../types';
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from '../fonts';

/** 石墨蓝主题 */
const theme: ThemeDefinition = {
  id: 'graphite',
  name: '石墨蓝',
  description: '冷调蓝灰 + 钢蓝主色的工具感科技风',
  order: 3,
  light: {
    background: '#f4f6f8',
    foreground: '#1a1d21',
    card: '#ffffff',
    cardForeground: '#1a1d21',
    popover: '#ffffff',
    popoverForeground: '#1a1d21',
    primary: '#2f6f8f',
    primaryForeground: '#ffffff',
    secondary: '#e7ebee',
    secondaryForeground: '#1a1d21',
    muted: '#e7ebee',
    mutedForeground: '#6a747d',
    accent: '#e7ebee',
    accentForeground: '#1a1d21',
    destructive: '#c1433b',
    border: '#d5dbe0',
    input: '#d5dbe0',
    ring: '#2f6f8f',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_MONO,
    radius: '0.5rem',
  },
  dark: {
    background: '#12161a',
    foreground: '#e7edf2',
    card: '#1a2026',
    cardForeground: '#e7edf2',
    popover: '#1f262d',
    popoverForeground: '#e7edf2',
    primary: '#5aa3c4',
    primaryForeground: '#0c1013',
    secondary: '#222a31',
    secondaryForeground: '#e7edf2',
    muted: '#222a31',
    mutedForeground: '#7f8b95',
    accent: '#222a31',
    accentForeground: '#e7edf2',
    destructive: '#e06a5a',
    border: '#2c343c',
    input: '#2c343c',
    ring: '#5aa3c4',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_MONO,
    radius: '0.5rem',
    glow: true,
  },
  preview: ['#f4f6f8', '#2f6f8f', '#5aa3c4'],
};

export default theme;
