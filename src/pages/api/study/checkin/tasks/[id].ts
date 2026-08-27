/**
 * PATCH/DELETE /api/study/checkin/tasks/[id] —— 打卡任务更新/删除（私密，登录）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { deleteCheckinTask, updateCheckinTask } from '@/lib/checkin-data';

export const prerender = false;

const MAX_NAME = 50;
const MAX_ICON = 20;

/** PATCH：{ name?, icon?, maxMakeupDays?, sort? } */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const patch: { name?: string; icon?: string | null; maxMakeupDays?: number; sort?: number } = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return json({ error: '任务名不能为空' }, 400);
    patch.name = name.slice(0, MAX_NAME);
  }
  if (body.icon !== undefined) patch.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  if (body.maxMakeupDays !== undefined && Number.isFinite(Number(body.maxMakeupDays))) {
    patch.maxMakeupDays = Math.max(0, Math.floor(Number(body.maxMakeupDays)));
  }
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.max(0, Math.floor(Number(body.sort)));
  try {
    const task = await updateCheckinTask(id, patch);
    if (!task) return json({ error: '任务不存在' }, 404);
    return json({ task });
  } catch (err) {
    console.error('[api/study/checkin/tasks]', err);
    return json({ error: '更新失败' }, 500);
  }
};

/** DELETE（级联删除记录） */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  try {
    await deleteCheckinTask(id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/study/checkin/tasks]', err);
    return json({ error: '删除失败' }, 500);
  }
};
