/**
 * GET/POST /api/calendar-events —— 重要日期
 *
 * - GET：列表（公开，含倒计时计算）
 * - POST：{ title, date, repeat } 新增（管理员，中间件保护）
 */
import type { APIRoute } from 'astro';
import { addEvent, listEvents } from '@/lib/calendar-data';
import { nextOccurrence } from '@/lib/calendar';
import { badJson, badRequest, json, jsonCached, readJson } from '@/lib/api';

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
  const body = await readJson<{ title?: unknown; date?: unknown; repeat?: unknown; lunar?: unknown; lunarDate?: unknown }>(request);
  if (!body) return badJson();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const date = typeof body.date === 'string' ? body.date : '';
  const repeat = body.repeat === true;
  const lunar = body.lunar === true;
  let lunarDate: string | null = null;
  if (lunar) {
    lunarDate = typeof body.lunarDate === 'string' ? body.lunarDate.trim() : '';
    if (!/^-?\d{2}-\d{2}$/.test(lunarDate)) {
      return badRequest('农历日期格式需为 MM-DD（闰月 -MM-DD）');
    }
  }
  if (!title) return badRequest('标题不能为空');
  if (!lunar && !DATE_RE.test(date)) return badRequest('日期格式不合法');
  const event = await addEvent(title.slice(0, 200), date, repeat, lunar, lunarDate);
  return json({ event });
};
