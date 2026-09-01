/**
 * GET/POST /api/calendar-events —— 重要日期
 *
 * - GET：列表（公开，含倒计时计算）
 * - POST：{ title, date, repeat } 新增（管理员，中间件保护）
 */
import type { APIRoute } from 'astro';
import { addEvent, listEvents } from '@/lib/calendar-data';
import { nextOccurrence } from '@/lib/calendar';
import { json, jsonCached } from '@/lib/api';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET：列表（公开），附带每次发生与倒计时 */
export const GET: APIRoute = async () => {
  const events = await listEvents();
  const today = new Date();
  return jsonCached({
    events: events.map((e) => {
      const next = nextOccurrence(e.date, e.repeat, today, e.lunar ? e.lunarDate : null);
      return {
        id: e.id,
        title: e.title,
        date: e.date,
        repeat: e.repeat,
        lunar: e.lunar,
        lunarDate: e.lunarDate,
        nextDate: next?.date ?? null,
        days: next?.days ?? null,
      };
    }),
  });
};

/** POST：新增（管理员） */
export const POST: APIRoute = async ({ request }) => {
  let body: { title?: unknown; date?: unknown; repeat?: unknown; lunar?: unknown; lunarDate?: unknown };
  try {
    body = (await request.json()) as {
      title?: unknown;
      date?: unknown;
      repeat?: unknown;
      lunar?: unknown;
      lunarDate?: unknown;
    };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const date = typeof body.date === 'string' ? body.date : '';
  const repeat = body.repeat === true;
  const lunar = body.lunar === true;
  let lunarDate: string | null = null;
  if (lunar) {
    lunarDate = typeof body.lunarDate === 'string' ? body.lunarDate.trim() : '';
    if (!/^-?\d{2}-\d{2}$/.test(lunarDate)) {
      return json({ error: '农历日期格式需为 MM-DD（闰月 -MM-DD）' }, 400);
    }
  }
  if (!title) return json({ error: '标题不能为空' }, 400);
  if (!lunar && !DATE_RE.test(date)) return json({ error: '日期格式不合法' }, 400);
  const event = await addEvent(title.slice(0, 200), date, repeat, lunar, lunarDate);
  return json({ event });
};
