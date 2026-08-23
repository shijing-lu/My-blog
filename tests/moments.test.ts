/**
 * 动态系统纯函数单元测试
 */
import { describe, expect, it } from 'vitest';
import { formatRelativeTime, isValidMedia } from '../src/lib/moments';

function dt(y: number, m: number, d: number, h = 12, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0);
}

describe('formatRelativeTime', () => {
  const now = dt(2026, 8, 23, 15, 30);

  it('刚刚 / 分钟 / 小时', () => {
    expect(formatRelativeTime(new Date(2026, 7, 23, 15, 29, 40), now)).toBe('刚刚');
    expect(formatRelativeTime(dt(2026, 8, 23, 15, 20), now)).toBe('10 分钟前');
    expect(formatRelativeTime(dt(2026, 8, 23, 13, 30), now)).toBe('2 小时前');
  });

  it('昨天 / 前几天 / 日期', () => {
    expect(formatRelativeTime(dt(2026, 8, 22, 14, 5), now)).toBe('昨天 14:05');
    expect(formatRelativeTime(dt(2026, 8, 18, 12, 0), now)).toBe('5 天前');
    expect(formatRelativeTime(dt(2026, 7, 1, 12, 0), now)).toBe('2026-07-01');
  });
});

describe('isValidMedia', () => {
  it('接受合法媒体项', () => {
    expect(isValidMedia({ type: 'image', url: '/api/images/x' })).toBe(true);
    expect(isValidMedia({ type: 'gif', url: 'https://a.com/1.gif' })).toBe(true);
    expect(isValidMedia({ type: 'video', url: 'https://a.com/1.mp4', poster: 'https://a.com/p.jpg' })).toBe(true);
  });

  it('拒绝非法媒体项', () => {
    expect(isValidMedia(null)).toBe(false);
    expect(isValidMedia({ type: 'audio', url: 'x' })).toBe(false);
    expect(isValidMedia({ type: 'image', url: '' })).toBe(false);
    expect(isValidMedia('x')).toBe(false);
    expect(isValidMedia({ type: 'image' })).toBe(false);
  });
});
