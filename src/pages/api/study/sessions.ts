/**
 * POST /api/study/sessions —— 上报完成的番茄（登录）
 *
 * body: { taskId?: string|null, durationSec: number }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { addStudySession } from '@/lib/study-data';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { taskId?: unknown; durationSec?: unknown };
  try {
    body = (await request.json()) as { taskId?: unknown; durationSec?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const durationSec = Number(body.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > 4 * 3600) {
    return json({ error: '专注时长不合法' }, 400);
  }
  const taskId = body.taskId === undefined || body.taskId === null ? null : String(body.taskId);
  if (taskId !== null && taskId.trim() === '') return json({ error: '任务 ID 不合法' }, 400);
  try {
    const session = await addStudySession({ taskId, durationSec });
    return json({ session }, 201);
  } catch (err) {
    console.error('[api/study/sessions]', err);
    return json({ error: '记录失败' }, 500);
  }
};
