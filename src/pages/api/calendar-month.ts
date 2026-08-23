/**
 * GET /api/calendar-month —— 日历页局部更新聚合接口
 *
 * 日历页点日期/切换月份时，前端 fetch 本接口拿到整月网格 + 选中日详情 + 即将到来，
 * 仅更新局部 DOM，不触发整页导航/转场（解决"点什么都在闪"）。
 *
 * 入参：month=YYYY-MM（默认当前月）、date=YYYY-MM-DD（默认今天）
 * 返回：monthTitle / grid（每格标记与农历信息）/ selected（选中日详情）/
 *       upcoming（未来 30 天重要日期）/ today（服务端今天，用于"今天"按钮）
 *
 * 数据与 SSR 完全同源（复用 buildMonthGrid / nextOccurrence / listEvents 等），
 * 保证局部更新与服务端渲染结果一致。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { buildMonthGrid, countdownText, dateKey, nextOccurrence } from '@/lib/calendar';
import { getDiaryByDate, listDiaryDates, listEvents, listTodos } from '@/lib/calendar-data';

export const prerender = false;

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 网格中一天的轻量序列化（仅前端渲染所需字段） */
function serializeDay(
  d: {
    date: string;
    day: number;
    isToday: boolean;
    isOtherMonth: boolean;
    lunarDay: string;
    lunarFull: string;
    jieQi: string;
    festivals: string[];
    ganZhi: string;
    shengXiao: string;
    hasDiary: boolean;
    todos: unknown[];
    events: unknown[];
  },
  authed: boolean,
) {
  return {
    date: d.date,
    day: d.day,
    isToday: d.isToday,
    isOtherMonth: d.isOtherMonth,
    lunarDay: d.lunarDay,
    lunarFull: d.lunarFull,
    jieQi: d.jieQi,
    festivals: d.festivals,
    ganZhi: d.ganZhi,
    shengXiao: d.shengXiao,
    // 待办/日记标记仅登录用户可见（未登录一律 false，与 SSR 行为一致）
    hasDiary: authed && d.hasDiary,
    hasTodo: authed && d.todos.length > 0,
    hasEvent: d.events.length > 0,
    // 悬浮预览 data-events 需要的事件标题（含"每年"标记）
    eventTitles: d.events.map((ev) => {
      const t = (ev as { title: string; repeat: boolean }).title;
      const r = (ev as { title: string; repeat: boolean }).repeat;
      return r ? `${t}（每年）` : t;
    }),
  };
}

export const GET: APIRoute = async ({ url, cookies }) => {
  const isAuthed = verifyRequest(cookies);
  const now = new Date();
  const todayKey = dateKey(now);

  const rawMonth = url.searchParams.get('month') ?? '';
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (MONTH_RE.test(rawMonth)) {
    year = Number(rawMonth.slice(0, 4));
    month = Number(rawMonth.slice(5, 7));
    if (month < 1 || month > 12) return json({ error: '月份不合法' }, 400);
  }
  const rawDate = url.searchParams.get('date') ?? '';
  const selectedKey = DATE_RE.test(rawDate) ? rawDate : todayKey;

  // 并行取数（与 index.astro 的 SSR 逻辑同源）
  const [events, todos, diaryDates] = await Promise.all([
    listEvents(),
    isAuthed ? listTodos() : Promise.resolve([]),
    isAuthed ? listDiaryDates() : Promise.resolve([]),
  ]);

  const grid = buildMonthGrid(year, month, {
    today: now,
    todos,
    events,
    diaryDates: new Set(diaryDates),
  });
  const selectedDay = grid.weeks.flat().find((d) => d.date === selectedKey);
  const selectedDiary = isAuthed && selectedKey ? await getDiaryByDate(selectedKey) : null;

  const upcoming = events
    .map((e) => ({ ...e, next: nextOccurrence(e.date, e.repeat, now, e.lunar ? e.lunarDate : null) }))
    .filter((x) => x.next !== null && x.next.days <= 30)
    .sort((a, b) => a.next!.days - b.next!.days);

  return json({
    month: `${year}-${String(month).padStart(2, '0')}`,
    monthTitle: `${year} 年 ${month} 月`,
    today: todayKey,
    grid: grid.weeks.flat().map((d) => serializeDay(d, isAuthed)),
    selected: {
      date: selectedKey,
      lunarFull: selectedDay?.lunarFull ?? '',
      jieQi: selectedDay?.jieQi ?? '',
      ganZhi: selectedDay?.ganZhi ?? '',
      shengXiao: selectedDay?.shengXiao ?? '',
      festivals: selectedDay?.festivals ?? [],
      hasDiary: isAuthed && !!selectedDiary,
      diaryTitle: isAuthed ? (selectedDiary?.title ?? '') : '',
      todos: isAuthed
        ? (selectedDay?.todos ?? []).map((t) => ({ id: t.id, text: t.text, done: t.done }))
        : [],
      events: (selectedDay?.events ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        repeat: e.repeat,
        lunar: e.lunar,
        lunarDate: e.lunarDate,
      })),
    },
    upcoming: upcoming.map((e) => ({
      id: e.id,
      title: e.title,
      date: e.next!.date,
      days: e.next!.days,
      countdown: countdownText(e.next!.days),
    })),
  });
};
