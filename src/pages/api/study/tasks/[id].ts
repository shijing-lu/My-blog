/**
 * PATCH/DELETE /api/study/tasks/[id] —— 学习任务更新/删除（私密，登录）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { deleteStudyTask, updateStudyTask } from '@/lib/study-data';

export const prerender = false;

const MAX_TITLE = 200;

/** PATCH：{ title?, estPomodoros?, done? } */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const patch: { title?: string; estPomodoros?: number; done?: boolean } = {};
  if (typeof body.title === 'string') {
    const title = body.title.trim();
    if (!title) return json({ error: '任务名不能为空' }, 400);
    patch.title = title.slice(0, MAX_TITLE);
  }
  if (body.estPomodoros !== undefined && Number.isFinite(Number(body.estPomodoros))) {
    patch.estPomodoros = Math.max(1, Math.floor(Number(body.estPomodoros)));
  }
  if (typeof body.done === 'boolean') patch.done = body.done;
  if (Object.keys(patch).length === 0) return json({ error: '没有可更新字段' }, 400);
  try {
    const task = await updateStudyTask(id, patch);
    if (!task) return json({ error: '任务不存在' }, 404);
    return json({ task });
  } catch (err) {
    console.error('[api/study/tasks]', err);
    return json({ error: '更新失败' }, 500);
  }
};

/** DELETE */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  try {
    const task = await deleteStudyTask(id);
    if (!task) return json({ error: '任务不存在' }, 404);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/study/tasks]', err);
    return json({ error: '删除失败' }, 500);
  }
};
