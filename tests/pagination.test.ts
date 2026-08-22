/**
 * 分页纯函数单元测试
 */
import { describe, expect, it } from 'vitest';
import { pageInfo, clampPage, pageWindow } from '../src/lib/pagination';

describe('pagination', () => {
  it('pageInfo 计算总页数与 offset，并收敛越界页号', () => {
    expect(pageInfo(1, 20, 9)).toEqual({
      page: 1,
      totalPages: 3,
      hasPrev: false,
      hasNext: true,
      offset: 0,
    });
    expect(pageInfo(2, 20, 9).offset).toBe(9);
    expect(pageInfo(0, 20, 9).page).toBe(1);
    expect(pageInfo(99, 20, 9).page).toBe(3);
    expect(pageInfo(2, 20, 9).hasPrev).toBe(true);
    expect(pageInfo(3, 20, 9).hasNext).toBe(false);
  });

  it('空数据时总页数至少为 1', () => {
    const info = pageInfo(1, 0, 9);
    expect(info.totalPages).toBe(1);
    expect(info.hasNext).toBe(false);
    expect(info.offset).toBe(0);
  });

  it('clampPage 处理非法输入', () => {
    expect(clampPage('abc', 5)).toBe(1);
    expect(clampPage(NaN, 5)).toBe(1);
    expect(clampPage(7, 5)).toBe(5);
    expect(clampPage(-3, 5)).toBe(1);
  });

  it('pageWindow：页数少全列，页数多折叠省略号', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    const w = pageWindow(5, 12);
    expect(w[0]).toBe(1);
    expect(w[w.length - 1]).toBe(12);
    expect(w).toContain('…');
    expect(pageWindow(1, 12)).toContain('…');
  });
});
