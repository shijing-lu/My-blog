/**
 * 日历系统纯函数：月网格构建 / 重要日期下一次发生日与倒计时
 *
 * - 月网格：给定年/月生成周日开头 6 行 × 7 列（含前后月补位）；
 * - 每天附带农历信息（getDayInfo）与待办/日记/事件标记；
 * - 重要日期：支持「每年重复」与「单次」，倒计时 = 距下一次发生日的天数。
 */
import { getDayInfo, lunarToSolar, type LunarDayInfo } from './lunar';

/** 本地时区 YYYY-MM-DD */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 待办（用于网格标记） */
export interface GridTodo {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  text: string;
  done: boolean;
}

/** 重要日期（用于网格标记） */
export interface GridEvent {
  id: string;
  /** 阳历日期 YYYY-MM-DD（lunar 为 false 时使用） */
  date: string;
  title: string;
  repeat: boolean;
  /** 是否农历日期 */
  lunar: boolean;
  /** 农历月日 "MM-DD"（闰月 "-MM-DD"） */
  lunarDate: string | null;
}

/** 网格中的一天 */
export interface CalendarDay extends LunarDayInfo {
  /** YYYY-MM-DD */
  date: string;
  /** 公历日号 1-31 */
  day: number;
  /** 是否今天 */
  isToday: boolean;
  /** 是否非当月（前后月补位） */
  isOtherMonth: boolean;
  /** 当日是否有日记 */
  hasDiary: boolean;
  /** 当日待办（未登录时为空数组） */
  todos: GridTodo[];
  /** 当日重要日期 */
  events: GridEvent[];
}

/** 月网格（按周分组，周日开头） */
export interface CalendarMonth {
  year: number;
  month: number; // 1-12
  weeks: CalendarDay[][];
}

/** 网格构建入参 */
export interface MonthGridOptions {
  /** 今天（注入便于测试） */
  today: Date;
  /** 全部待办（按 date 分组） */
  todos?: GridTodo[];
  /** 全部重要日期 */
  events?: GridEvent[];
  /** 有日记的日期集合（YYYY-MM-DD） */
  diaryDates?: Set<string>;
}

/**
 * 构建某月的日历网格（6 行 × 7 列，周日开头）
 */
export function buildMonthGrid(year: number, month: number, opts: MonthGridOptions): CalendarMonth {
  const { today, todos = [], events = [], diaryDates = new Set() } = opts;
  const todayKey = dateKey(today);

  const todoByDate = new Map<string, GridTodo[]>();
  todos.forEach((t) => {
    const list = todoByDate.get(t.date) ?? [];
    list.push(t);
    todoByDate.set(t.date, list);
  });
  // 事件按「该网格年对应的阳历日」分组：农历事件先用 lunarToSolar 落到当年阳历
  const eventByDate = new Map<string, GridEvent[]>();
  events.forEach((e) => {
    let key = e.date;
    if (e.lunar && e.lunarDate) {
      const solar = lunarToSolar(e.lunarDate, year);
      if (!solar) return; // 该年无此农历日（如无对应闰月）→ 本年不标记
      key = dateKey(solar);
    }
    const list = eventByDate.get(key) ?? [];
    list.push(e);
    eventByDate.set(key, list);
  });

  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  // 当月 1 号是周几（0=周日），向前补位数
  const lead = firstDay.getDay();

  const weeks: CalendarDay[][] = [];
  let week: CalendarDay[] = [];

  // 前月补位
  for (let i = lead - 1; i >= 0; i -= 1) {
    const d = new Date(year, month - 1, -i);
    week.push(makeDay(d, true, todayKey, todoByDate, eventByDate, diaryDates));
  }
  // 当月
  for (let day = 1; day <= daysInMonth; day += 1) {
    const d = new Date(year, month - 1, day);
    week.push(makeDay(d, false, todayKey, todoByDate, eventByDate, diaryDates));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  // 后月补位
  let next = 1;
  while (week.length < 7) {
    const d = new Date(year, month, next);
    week.push(makeDay(d, true, todayKey, todoByDate, eventByDate, diaryDates));
    next += 1;
  }
  if (week.length > 0) weeks.push(week);

  return { year, month, weeks };
}

/** 组装一天 */
function makeDay(
  d: Date,
  isOtherMonth: boolean,
  todayKey: string,
  todoByDate: Map<string, GridTodo[]>,
  eventByDate: Map<string, GridEvent[]>,
  diaryDates: Set<string>,
): CalendarDay {
  const key = dateKey(d);
  return {
    ...getDayInfo(d),
    date: key,
    day: d.getDate(),
    isToday: key === todayKey,
    isOtherMonth,
    hasDiary: diaryDates.has(key),
    todos: todoByDate.get(key) ?? [],
    events: eventByDate.get(key) ?? [],
  };
}

/** 下一次发生结果 */
export interface NextOccurrence {
  /** 下一次发生的日期（YYYY-MM-DD） */
  date: string;
  /** 距今天数（今天=0，明天=1） */
  days: number;
}

/**
 * 计算重要日期的下一次发生日与倒计时
 *
 * @param date 阳历日期 YYYY-MM-DD（lunar 时仍作为参照）
 * @param repeat 是否每年重复
 * @param today 今天（注入便于测试）
 * @param lunarDate 农历月日（lunar 时使用）；null 表示阳历
 * @returns 下一次发生信息；单次事件已过期返回 null
 */
export function nextOccurrence(
  date: string,
  repeat: boolean,
  today: Date,
  lunarDate?: string | null,
): NextOccurrence | null {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // 农历日期：取今年或明年的对应阳历日
  if (lunarDate) {
    for (const y of [todayStart.getFullYear(), todayStart.getFullYear() + 1]) {
      const solar = lunarToSolar(lunarDate, y);
      if (!solar) continue; // 该农历年无此月日
      if (solar.getTime() >= todayStart.getTime()) {
        const days = Math.round((solar.getTime() - todayStart.getTime()) / 86400000);
        return { date: dateKey(solar), days };
      }
    }
    return null;
  }

  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;

  let next: Date;
  if (repeat) {
    let candidate = new Date(todayStart.getFullYear(), m - 1, d);
    if (candidate.getTime() < todayStart.getTime()) {
      candidate = new Date(todayStart.getFullYear() + 1, m - 1, d);
    }
    next = candidate;
  } else {
    next = new Date(y, m - 1, d);
    if (next.getTime() < todayStart.getTime()) return null; // 已过期
  }

  const days = Math.round((next.getTime() - todayStart.getTime()) / 86400000);
  return { date: dateKey(next), days };
}

/** 倒计时文案：今天 / 明天 / 还有 N 天 */
export function countdownText(days: number): string {
  if (days <= 0) return '今天';
  if (days === 1) return '明天';
  return `还有 ${days} 天`;
}
