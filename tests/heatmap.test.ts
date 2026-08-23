/**
 * 首页文章热力图 buildHeatmap 纯函数单元测试
 */
import { describe, expect, it } from 'vitest';
import { buildHeatmap } from '../src/lib/heatmap';

/** 构造本地时区某日 Date */
function dt(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0);
}

describe('buildHeatmap', () => {
  it('空数据仍生成 12 个月网格，全 0', () => {
    const end = dt(2026, 8, 23);
    const data = buildHeatmap([], end, 12);
    expect(data.monthly).toHaveLength(12);
    expect(data.weeks.length).toBeGreaterThan(50);
    expect(data.stats).toEqual({ posts: 0, days: 0, words: 0 });
    // 所有周、每天 count 为 0
    expect(data.weeks.every((w) => w.every((d) => d.count === 0))).toBe(true);
  });

  it('网格起始对齐到周日', () => {
    // 2026-08-23 是周日（getDay 0）
    const end = new Date(2026, 7, 23, 12); // 8月23日
    const data = buildHeatmap([], end, 1);
    const start = new Date(data.startDate + 'T12:00:00');
    expect(start.getDay()).toBe(0); // 周日
    // startDate 应不超过 8 月 1 日往前推一周
    expect(data.startDate <= '2026-08-01').toBe(true);
  });

  it('同文同日（createdAt = updatedAt）只计 1', () => {
    const a = { createdAt: dt(2026, 8, 20), updatedAt: dt(2026, 8, 20), content: 'hello' };
    const data = buildHeatmap([a], dt(2026, 8, 23), 1);
    // 找到该天
    let count = 0;
    data.weeks.forEach((w) => w.forEach((d) => { if (d.date === '2026-08-20') count = d.count; }));
    expect(count).toBe(1);
    expect(data.stats.days).toBe(1);
  });

  it('同一篇文章在创建日和更新日（不同日）算两天活跃', () => {
    const a = { createdAt: dt(2026, 8, 1), updatedAt: dt(2026, 8, 20), content: 'hello world' };
    const data = buildHeatmap([a], dt(2026, 8, 23), 1);
    const get = (date: string): number => {
      let c = 0;
      data.weeks.forEach((w) => w.forEach((d) => { if (d.date === date) c = d.count; }));
      return c;
    };
    expect(get('2026-08-01')).toBe(1);
    expect(get('2026-08-20')).toBe(1);
    expect(data.stats.days).toBe(2);
  });

  it('统计字段正确（posts/days/words）', () => {
    const a1 = { createdAt: dt(2026, 8, 1), updatedAt: dt(2026, 8, 1), content: 'abc' };
    const a2 = { createdAt: dt(2026, 8, 2), updatedAt: dt(2026, 8, 5), content: 'def ghi' };
    const data = buildHeatmap([a1, a2], dt(2026, 8, 23), 1);
    expect(data.stats.posts).toBe(2);
    expect(data.stats.days).toBe(3); // 08-01, 08-02, 08-05
    expect(data.stats.words).toBe(9); // 'abc'(3) + 'def ghi' 去空格 'defghi'(6)
  });

  it('月度聚合跨月正确', () => {
    const a = { createdAt: dt(2026, 7, 5), updatedAt: dt(2026, 7, 5), content: 'x' };
    const data = buildHeatmap([a], dt(2026, 8, 23), 2);
    expect(data.monthly.map((m) => m.month)).toEqual(['2026-07', '2026-08']);
    const july = data.monthly.find((m) => m.month === '2026-07');
    expect(july?.total).toBe(1);
  });
});
