/**
 * 归档时间线（article-timeline）单元测试
 *
 * 覆盖三块易错的纯逻辑：
 * 1. 北京时间部件（跨时区/跨日边界）—— Vercel 跑 UTC，凌晨文章最易被归错天；
 * 2. 年 → 月分组与排序（按 createdAt 倒序，不依赖入参顺序）；
 * 3. 导航项 key 与锚点 id 的一致性（两处手写会漂移，故用导出的 helper 断言）。
 */
import { describe, expect, it } from 'vitest';
import {
  bjDateParts,
  buildArticleTimeline,
  formatWordCount,
  monthAnchorId,
  timelineNavItems,
  weekdayLabel,
  yearAnchorId,
} from '../src/lib/article-timeline';
import type { ArticleMeta } from '../db/types';

/** 构造一条文章元信息（只填断言用得到的字段） */
function meta(id: string, createdAt: string, title = id): ArticleMeta & { contentLength: number } {
  return {
    id,
    title,
    slug: id,
    type: 'tech',
    summary: '',
    cover: null,
    tags: [],
    encrypted: false,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    contentLength: 100,
  };
}

describe('bjDateParts（北京时间）', () => {
  it('UTC 晚间会跨到北京时间的次日（避免被归错天）', () => {
    // UTC 2026-09-10 17:00 → 北京时间 2026-09-11 01:00
    const p = bjDateParts(new Date(Date.UTC(2026, 8, 10, 17, 0)));
    expect(p.y).toBe(2026);
    expect(p.mo).toBe(9);
    expect(p.d).toBe(11);
  });

  it('UTC 深夜会跨到北京时间的次月首日', () => {
    // UTC 2026-08-31 16:30 → 北京时间 2026-09-01 00:30
    const p = bjDateParts(new Date(Date.UTC(2026, 7, 31, 16, 30)));
    expect(p.mo).toBe(9);
    expect(p.d).toBe(1);
  });

  it('返回与 Date#getDay 同序的星期（周日=0）', () => {
    // 2026-09-12 是周六
    expect(bjDateParts(new Date(Date.UTC(2026, 8, 12, 4, 0))).weekday).toBe(6);
  });
});

describe('weekdayLabel', () => {
  it('0–6 映射到中文星期', () => {
    expect(weekdayLabel(0)).toBe('周日');
    expect(weekdayLabel(3)).toBe('周三');
    expect(weekdayLabel(6)).toBe('周六');
  });

  it('越界回退为空串（不抛错）', () => {
    expect(weekdayLabel(7)).toBe('');
    expect(weekdayLabel(-1)).toBe('');
  });
});

describe('formatWordCount', () => {
  it('千位以上转 x.xk，以下原样', () => {
    expect(formatWordCount(5646)).toBe('5.6k');
    expect(formatWordCount(1000)).toBe('1.0k');
    expect(formatWordCount(397)).toBe('397');
    expect(formatWordCount(0)).toBe('0');
  });
});

describe('buildArticleTimeline', () => {
  it('空输入返回空数组', () => {
    expect(buildArticleTimeline([])).toEqual([]);
  });

  it('按 createdAt 倒序排列（不依赖入参顺序）', () => {
    // 刻意乱序传入
    const result = buildArticleTimeline([
      meta('b', '2026-09-05T10:00:00Z'),
      meta('c', '2026-09-01T10:00:00Z'),
      meta('a', '2026-09-09T10:00:00Z'),
    ]);
    const ids = result[0]!.months[0]!.entries.map((e) => e.meta.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('按年 → 月分组，且年月均倒序', () => {
    const result = buildArticleTimeline([
      meta('old', '2025-03-02T10:00:00Z'),
      meta('new', '2026-09-09T10:00:00Z'),
      meta('mid', '2026-08-20T10:00:00Z'),
    ]);
    expect(result.map((y) => y.year)).toEqual([2026, 2025]);
    expect(result[0]!.months.map((m) => m.month)).toEqual([9, 8]);
    expect(result[1]!.months.map((m) => m.month)).toEqual([3]);
  });

  it('年份/月份的 count 与实际条目数一致', () => {
    const result = buildArticleTimeline([
      meta('a', '2026-09-09T10:00:00Z'),
      meta('b', '2026-09-05T10:00:00Z'),
      meta('c', '2026-08-20T10:00:00Z'),
    ]);
    const y2026 = result[0]!;
    expect(y2026.count).toBe(3);
    expect(y2026.months.find((m) => m.month === 9)!.count).toBe(2);
    expect(y2026.months.find((m) => m.month === 8)!.count).toBe(1);
    // 年份总数 = 各月之和
    expect(y2026.months.reduce((sum, m) => sum + m.count, 0)).toBe(y2026.count);
  });

  it('保留 contentLength（列表不取正文，字数来自聚合列）', () => {
    const [year] = buildArticleTimeline([{ ...meta('a', '2026-09-09T10:00:00Z'), contentLength: 5646 }]);
    expect(year!.months[0]!.entries[0]!.contentLength).toBe(5646);
  });
});

describe('timelineNavItems', () => {
  it('展平为年 + 月的导航项，key 与锚点 id 一致', () => {
    const years = buildArticleTimeline([
      meta('a', '2026-09-09T10:00:00Z'),
      meta('b', '2026-08-20T10:00:00Z'),
    ]);
    const items = timelineNavItems(years);
    expect(items.map((i) => i.date)).toEqual(['y-2026', 'm-2026-9', 'm-2026-8']);
    // 导航 key 必须与页面元素 id 用同一套生成规则
    expect(items[0]!.date).toBe(yearAnchorId(2026));
    expect(items[1]!.date).toBe(monthAnchorId(2026, 9));
  });

  it('携带各节点计数', () => {
    const years = buildArticleTimeline([
      meta('a', '2026-09-09T10:00:00Z'),
      meta('b', '2026-09-05T10:00:00Z'),
    ]);
    const items = timelineNavItems(years);
    expect(items[0]).toMatchObject({ label: '2026 年', count: 2 });
    expect(items[1]).toMatchObject({ label: '9 月', count: 2 });
  });
});
