/**
 * 影集工具纯函数单元测试
 */
import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/lib/photos';

/** 构造本地时区某日的 Date（避免时区差异） */
function dateAt(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0);
}

describe('buildTimeline', () => {
  it('按本地时区把日期聚合为 YYYY-MM-DD 并倒序', () => {
    const rows = [
      { takenAt: dateAt(2026, 8, 23) },
      { takenAt: dateAt(2026, 8, 23) },
      { takenAt: dateAt(2026, 8, 1) },
      { takenAt: dateAt(2025, 12, 31) },
    ];
    expect(buildTimeline(rows)).toEqual([
      { date: '2026-08-23', count: 2 },
      { date: '2026-08-01', count: 1 },
      { date: '2025-12-31', count: 1 },
    ]);
  });

  it('空输入返回空数组', () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it('同日多次上传只算一个节点', () => {
    const rows = [
      { takenAt: dateAt(2026, 8, 23) },
      { takenAt: dateAt(2026, 8, 23) },
      { takenAt: dateAt(2026, 8, 23) },
    ];
    expect(buildTimeline(rows)).toEqual([{ date: '2026-08-23', count: 3 }]);
  });
});
