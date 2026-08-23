/**
 * PATCH/DELETE /api/todos/[id] —— 待办更新/删除（私密，登录）
 */
import type { APIRoute } from 'astro';
import { deleteTodo, updateTodo } from '@/lib/calendar-data';
import { json } from '@/lib/api';

export const prerender = false;

/** PATCH：{ text?, done? } */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const patch: { text?: string; done?: boolean } = {};
  if (typeof body.text === 'string') patch.text = body.text.slice(0, 500);
  if (typeof body.done === 'boolean') patch.done = body.done;
  if (Object.keys(patch).length === 0) return json({ error: '没有可更新字段' }, 400);
  const todo = await updateTodo(id, patch);
  if (!todo) return json({ error: '待办不存在' }, 404);
  return json({ todo });
};

/** DELETE */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const todo = await deleteTodo(id);
  if (!todo) return json({ error: '待办不存在' }, 404);
  return json({ ok: true });
};
