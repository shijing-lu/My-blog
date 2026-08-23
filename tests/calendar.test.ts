/**
 * 日历系统纯函数单元测试
 */
import { describe, expect, it } from 'vitest';
import { buildMonthGrid, nextOccurrence, countdownText, dateKey } from '../src/lib/calendar';
import { getDayInfo, lunarToSolar } from '../src/lib/lunar';

/** 构造本地时区某日 */
function dt(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0);
}

describe('getDayInfo', () => {
  it('2026-08-23 是处暑节气、农历七月十一', () => {
    const info = getDayInfo(dt(2026, 8, 23));
    expect(info.jieQi).toBe('处暑');
    expect(info.lunarFull).toContain('七月');
    expect(info.lunarDay).toBe('十一');
    expect(info.ganZhi.length).toBeGreaterThan(0);
  });

  it('普通日期无节气', () => {
    const info = getDayInfo(dt(2026, 8, 20));
    expect(info.jieQi).toBe('');
  });
});

describe('buildMonthGrid', () => {
  it('2026-08 网格：周日开头、6 周、前后月补位', () => {
    const grid = buildMonthGrid(2026, 8, { today: dt(2026, 8, 23) });
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks[0]!).toHaveLength(7);
    // 2026-08-01 是周六，前面应有 6 天补位
    expect(grid.weeks[0]![0]!.isOtherMonth).toBe(true);
    expect(grid.weeks[0]![6]!.date).toBe('2026-08-01');
    // 今天标记
    const today = grid.weeks.flat().find((d) => d.date === '2026-08-23');
    expect(today?.isToday).toBe(true);
  });

  it('待办/事件/日记按日期挂到对应天', () => {
    const grid = buildMonthGrid(2026, 8, {
      today: dt(2026, 8, 23),
      todos: [{ id: 't1', date: '2026-08-23', text: '写周报', done: false }],
      events: [{ id: 'e1', date: '2026-08-23', title: '生日', repeat: true, lunar: false, lunarDate: null }],
      diaryDates: new Set(['2026-08-20']),
    });
    const day = grid.weeks.flat().find((d) => d.date === '2026-08-23')!;
    expect(day.todos).toHaveLength(1);
    expect(day.todos[0]!.text).toBe('写周报');
    expect(day.events).toHaveLength(1);
    const diary = grid.weeks.flat().find((d) => d.date === '2026-08-20')!;
    expect(diary.hasDiary).toBe(true);
  });
});

describe('nextOccurrence / countdownText', () => {
  it('每年重复：今年已过 → 明年，倒计时正确', () => {
    const next = nextOccurrence('2026-01-01', true, dt(2026, 8, 23));
    expect(next?.date).toBe('2027-01-01');
    expect(next?.days).toBeGreaterThan(100);
  });

  it('每年重复：今年未到 → 今年', () => {
    const next = nextOccurrence('2026-10-01', true, dt(2026, 8, 23));
    expect(next?.date).toBe('2026-10-01');
    expect(next?.days).toBe(39); // 8-23 → 10-01
  });

  it('单次：未到 → 倒计时；已过 → null', () => {
    expect(nextOccurrence('2026-09-01', false, dt(2026, 8, 23))?.days).toBe(9);
    expect(nextOccurrence('2026-08-01', false, dt(2026, 8, 23))).toBeNull();
  });

  it('今天/明天/还有 N 天文案', () => {
    expect(countdownText(0)).toBe('今天');
    expect(countdownText(1)).toBe('明天');
    expect(countdownText(23)).toBe('还有 23 天');
  });

  it('dateKey 本地时区 YYYY-MM-DD', () => {
    expect(dateKey(dt(2026, 8, 5))).toBe('2026-08-05');
  });
});

describe('lunarToSolar / 农历事件', () => {
  it('2026 农历八月十五 → 阳历 2026-09-25', () => {
    const solar = lunarToSolar('08-15', 2026);
    expect(solar).not.toBeNull();
    expect(dateKey(solar!)).toBe('2026-09-25');
  });

  it('农历生日在网格中落到当年阳历日', () => {
    const grid = buildMonthGrid(2026, 9, {
      today: dt(2026, 8, 23),
      events: [{ id: 'e1', date: '2026-01-01', title: '农历生日', repeat: true, lunar: true, lunarDate: '08-15' }],
    });
    const day = grid.weeks.flat().find((d) => d.date === '2026-09-25');
    expect(day?.events.some((ev) => ev.lunar && ev.lunarDate === '08-15')).toBe(true);
  });

  it('农历事件倒计时按下一次农历年计算', () => {
    // 今天 2026-08-23；农历八月十五 = 2026-09-25（今年）
    const next = nextOccurrence('2026-01-01', true, dt(2026, 8, 23), '08-15');
    expect(next?.date).toBe('2026-09-25');
    expect(next?.days).toBe(33); // 8-23 → 9-25
  });

  it('农历倒计时跨年：今年已过 → 明年', () => {
    // 农历正月初一：2026-02-17，2026-08-23 已过 → 2027 年
    const next = nextOccurrence('2026-01-01', true, dt(2026, 8, 23), '01-01');
    expect(next?.date.startsWith('2027')).toBe(true);
  });

  it('该年无此闰月 → 农历转换返回 null', () => {
    // 2026 年没有闰七月
    expect(lunarToSolar('-07-03', 2026)).toBeNull();
  });
});
