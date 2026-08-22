/**
 * 主题：Claude·像素（默认）
 *
 * 亮 = Claude 暖奶油底 + 陶土橙；暗 = 复古暗黑终端 + 陶土橙霓虹。
 * 含像素字体（品牌字/标签）与霓虹光晕。
 */
import type { ThemeDefinition } from '../types';
import { FONT_DISPLAY, FONT_PIXEL, FONT_SANS } from '../fonts';

/** Claude·像素（默认）主题 */
const theme: ThemeDefinition = {
  id: 'claude-pixel',
  name: 'Claude·像素',
  description: 'Claude 暖奶油编辑风 + 复古像素点缀（默认）',
  order: 0,
  isDefault: true,
  light: {
    background: '#faf9f5',
    foreground: '#141413',
    card: '#ffffff',
    cardForeground: '#141413',
    popover: '#ffffff',
    popoverForeground: '#141413',
    primary: '#b3542d',
    primaryForeground: '#ffffff',
    secondary: '#efede4',
    secondaryForeground: '#141413',
    muted: '#efede4',
    mutedForeground: '#6f6a60',
    accent: '#efede4',
    accentForeground: '#141413',
    destructive: '#c0362c',
    border: '#e3ddd1',
    input: '#e3ddd1',
    ring: '#b3542d',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_PIXEL,
    radius: '0.75rem',
  },
  dark: {
    background: '#0f0e0d',
    foreground: '#ede7dc',
    card: '#171514',
    cardForeground: '#ede7dc',
    popover: '#1b1917',
    popoverForeground: '#ede7dc',
    primary: '#e08b6e',
    primaryForeground: '#0f0e0d',
    secondary: '#1e1c1a',
    secondaryForeground: '#ede7dc',
    muted: '#1e1c1a',
    mutedForeground: '#8a837a',
    accent: '#1e1c1a',
    accentForeground: '#ede7dc',
    destructive: '#e06a5a',
    border: '#2a2724',
    input: '#2a2724',
    ring: '#b3542d',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_PIXEL,
    radius: '0.75rem',
    glow: true,
  },
  preview: ['#faf9f5', '#b3542d', '#6b8f71'],
};

export default theme;
