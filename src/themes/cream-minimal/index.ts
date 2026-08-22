/**
 * 主题：极简奶油
 *
 * 更素、无像素修饰、无霓虹光晕；柔和陶土主色 + 更圆润的圆角。
 */
import type { ThemeDefinition } from '../types';
import { FONT_DISPLAY, FONT_SANS } from '../fonts';

/** 极简奶油主题 */
const theme: ThemeDefinition = {
  id: 'cream-minimal',
  name: '极简奶油',
  description: '素净暖白 + 柔和陶土，去像素修饰的无扰阅读',
  order: 2,
  light: {
    background: '#fbf8f2',
    foreground: '#1c1b18',
    card: '#ffffff',
    cardForeground: '#1c1b18',
    popover: '#ffffff',
    popoverForeground: '#1c1b18',
    primary: '#a3542c',
    primaryForeground: '#ffffff',
    secondary: '#f2ede2',
    secondaryForeground: '#1c1b18',
    muted: '#f2ede2',
    mutedForeground: '#7d776b',
    accent: '#f2ede2',
    accentForeground: '#1c1b18',
    destructive: '#b5433b',
    border: '#e6dfd2',
    input: '#e6dfd2',
    ring: '#a3542c',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_SANS,
    radius: '1rem',
  },
  dark: {
    background: '#1d1c19',
    foreground: '#eae5da',
    card: '#25231f',
    cardForeground: '#eae5da',
    popover: '#2a2723',
    popoverForeground: '#eae5da',
    primary: '#d0795a',
    primaryForeground: '#12110f',
    secondary: '#2b2924',
    secondaryForeground: '#eae5da',
    muted: '#2b2924',
    mutedForeground: '#96907f',
    accent: '#2b2924',
    accentForeground: '#eae5da',
    destructive: '#d0655a',
    border: '#332f29',
    input: '#332f29',
    ring: '#d0795a',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_SANS,
    radius: '1rem',
  },
  preview: ['#fbf8f2', '#a3542c', '#8a7f5e'],
};

export default theme;
