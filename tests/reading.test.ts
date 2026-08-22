/**
 * 阅读统计单元测试
 */
import { describe, expect, it } from 'vitest';
import { countChars, readingTime } from '../src/lib/reading';

describe('reading', () => {
  it('统计去空白后的字符数', () => {
    expect(countChars('hello  world\n中文')).toBe(12);
    expect(countChars('')).toBe(0);
  });

  it('阅读时长最少 1 分钟，按约 400 字/分钟', () => {
    expect(readingTime('a')).toBe(1);
    expect(readingTime('字'.repeat(800))).toBe(2);
  });
});
