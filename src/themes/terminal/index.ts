/**
 * 主题：暗黑终端（d-d.design 式）
 *
 * 近黑暖色 + 强烈陶土橙霓虹光晕，偏复古终端信息门户气质。
 */
import type { ThemeDefinition } from '../types';
import { FONT_DISPLAY, FONT_PIXEL, FONT_SANS } from '../fonts';

/** 暗黑终端主题 */
const theme: ThemeDefinition = {
  id: 'terminal',
  name: '暗黑终端',
  description: 'd-d.design 式复古暗黑终端：近黑 + 陶土橙霓虹',
  order: 1,
  light: {
    background: '#1a1917',
    foreground: '#e8e2d7',
    card: '#211f1c',
    cardForeground: '#e8e2d7',
    popover: '#26231f',
    popoverForeground: '#e8e2d7',
    primary: '#ff6b4a',
    primaryForeground: '#0f0e0d',
    secondary: '#2a2724',
    secondaryForeground: '#e8e2d7',
    muted: '#2a2724',
    mutedForeground: '#9a9287',
    accent: '#2a2724',
    accentForeground: '#e8e2d7',
    destructive: '#ff5a4a',
    border: '#3a3531',
    input: '#3a3531',
    ring: '#ff6b4a',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_PIXEL,
    radius: '0.375rem',
    glow: true,
  },
  dark: {
    background: '#070605',
    foreground: '#f2ead9',
    card: '#100e0d',
    cardForeground: '#f2ead9',
    popover: '#14110f',
    popoverForeground: '#f2ead9',
    primary: '#ff7a52',
    primaryForeground: '#0a0908',
    secondary: '#1a1816',
    secondaryForeground: '#f2ead9',
    muted: '#1a1816',
    mutedForeground: '#8a8175',
    accent: '#1a1816',
    accentForeground: '#f2ead9',
    destructive: '#ff5a4a',
    border: '#241f1b',
    input: '#241f1b',
    ring: '#ff7a52',
    fontSans: FONT_SANS,
    fontDisplay: FONT_DISPLAY,
    fontPixel: FONT_PIXEL,
    radius: '0.375rem',
    glow: true,
  },
  preview: ['#0f0e0d', '#ff6b4a', '#ff7a52'],
};

export default theme;
