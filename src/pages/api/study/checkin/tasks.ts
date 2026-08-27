/**
 * GET/POST /api/study/checkin/tasks —— 打卡任务（私密，登录）
 *
 * - GET：任务列表（含今日状态/连击/累计/记录日期）
 * - POST：{ name, icon?, maxMakeupDays? } 新增
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { addCheckinTask, listCheckinTasks } from '@/lib/checkin-data';

export const prerender = false;

const MAX_NAME = 50;
const MAX_ICON = 20;

export const GET: APIRoute = async () => {
  try {
    const tasks = await listCheckinTasks();
    return json({ tasks });
  } catch (err) {
    console.error('[api/study/checkin/tasks]', err);
    return json({ error: '读取失败' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: { name?: unknown; icon?: unknown; maxMakeupDays?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; icon?: unknown; maxMakeupDays?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return json({ error: '请填写打卡任务名' }, 400);
  const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, MAX_ICON) : null;
  const maxMakeupDays = Number.isFinite(Number(body.maxMakeupDays)) ? Math.max(0, Math.floor(Number(body.maxMakeupDays))) : 1;
  try {
    const task = await addCheckinTask({ name, icon, maxMakeupDays });
    return json({ task }, 201);
  } catch (err) {
    console.error('[api/study/checkin/tasks]', err);
    return json({ error: '创建失败' }, 500);
  }
};
