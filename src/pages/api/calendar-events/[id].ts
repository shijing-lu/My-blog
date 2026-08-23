/**
 * PATCH/DELETE /api/calendar-events/[id] —— 重要日期更新/删除（管理员）
 */
import type { APIRoute } from 'astro';
import { deleteEvent, updateEvent } from '@/lib/calendar-data';
import { json } from '@/lib/api';

export const prerender = false;

/** PATCH：{ title?, date?, repeat?, lunar?, lunarDate? } */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const patch: { title?: string; date?: string; repeat?: boolean; lunar?: boolean; lunarDate?: string | null } = {};
  if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200);
  if (typeof body.date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return json({ error: '日期格式不合法' }, 400);
    patch.date = body.date;
  }
  if (typeof body.repeat === 'boolean') patch.repeat = body.repeat;
  if (typeof body.lunar === 'boolean') {
    patch.lunar = body.lunar;
    if (body.lunar) {
      const lunarDate = typeof body.lunarDate === 'string' ? body.lunarDate.trim() : '';
      if (!/^-?\d{2}-\d{2}$/.test(lunarDate)) return json({ error: '农历日期格式需为 MM-DD' }, 400);
      patch.lunarDate = lunarDate;
    }
  }
  if (Object.keys(patch).length === 0) return json({ error: '没有可更新字段' }, 400);
  const event = await updateEvent(id, patch);
  if (!event) return json({ error: '事件不存在' }, 404);
  return json({ event });
};

/** DELETE */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const event = await deleteEvent(id);
  if (!event) return json({ error: '事件不存在' }, 404);
  return json({ ok: true });
};
