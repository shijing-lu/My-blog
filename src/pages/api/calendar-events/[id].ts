/**
 * PATCH/DELETE /api/calendar-events/[id] —— 重要日期更新/删除（管理员）
 */
import type { APIRoute } from 'astro';
import { deleteEvent, updateEvent } from '@/lib/calendar-data';
import { badJson, badRequest, json, missing, notFound, readJson } from '@/lib/api';

export const prerender = false;

/** PATCH：{ title?, date?, repeat?, lunar?, lunarDate? } */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  const patch: { title?: string; date?: string; repeat?: boolean; lunar?: boolean; lunarDate?: string | null } = {};
  if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200);
  if (typeof body.date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return badRequest('日期格式不合法');
    patch.date = body.date;
  }
  if (typeof body.repeat === 'boolean') patch.repeat = body.repeat;
  if (typeof body.lunar === 'boolean') {
    patch.lunar = body.lunar;
    if (body.lunar) {
      const lunarDate = typeof body.lunarDate === 'string' ? body.lunarDate.trim() : '';
      if (!/^-?\d{2}-\d{2}$/.test(lunarDate)) return badRequest('农历日期格式需为 MM-DD');
      patch.lunarDate = lunarDate;
    }
  }
  if (Object.keys(patch).length === 0) return badRequest('没有可更新字段');
  const event = await updateEvent(id, patch);
  if (!event) return notFound('事件不存在');
  return json({ event });
};

/** DELETE */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  const event = await deleteEvent(id);
  if (!event) return notFound('事件不存在');
  return json({ ok: true });
};
