/**
 * GET/POST /api/study/tasks —— 学习任务（私密，登录）
 *
 * - GET：列表（含每任务已完成番茄数）
 * - POST：{ title, estPomodoros? } 新增
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { addStudyTask, listStudyTasks } from '@/lib/study-data';

export const prerender = false;

const MAX_TITLE = 200;

/** GET：任务列表（登录） */
export const GET: APIRoute = async () => {
  try {
    const tasks = await listStudyTasks();
    return json({ tasks });
  } catch (err) {
    console.error('[api/study/tasks]', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** POST：新增任务（登录） */
export const POST: APIRoute = async ({ request }) => {
  let body: { title?: unknown; estPomodoros?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; estPomodoros?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return json({ error: '请填写任务名' }, 400);
  const estPomodoros = Number.isFinite(Number(body.estPomodoros)) ? Math.max(1, Math.floor(Number(body.estPomodoros))) : 1;
  try {
    const task = await addStudyTask({ title: title.slice(0, MAX_TITLE), estPomodoros });
    return json({ task }, 201);
  } catch (err) {
    console.error('[api/study/tasks]', err);
    return json({ error: '创建失败' }, 500);
  }
};
