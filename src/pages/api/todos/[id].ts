/**
 * PATCH/DELETE /api/todos/[id] —— 待办更新/删除（私密，登录）
 */
import type { APIRoute } from 'astro';
import { deleteTodo, updateTodo } from '@/lib/calendar-data';
import { badJson, badRequest, json, missing, notFound, readJson } from '@/lib/api';

export const prerender = false;

/** PATCH：{ text?, done? } */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  const patch: { text?: string; done?: boolean } = {};
  if (typeof body.text === 'string') patch.text = body.text.slice(0, 500);
  if (typeof body.done === 'boolean') patch.done = body.done;
  if (Object.keys(patch).length === 0) return badRequest('没有可更新字段');
  const todo = await updateTodo(id, patch);
  if (!todo) return notFound('待办不存在');
  return json({ todo });
};

/** DELETE */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  const todo = await deleteTodo(id);
  if (!todo) return notFound('待办不存在');
  return json({ ok: true });
};
