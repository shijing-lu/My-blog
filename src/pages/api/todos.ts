/**
 * GET/POST /api/todos —— 待办（私密，全部需登录）
 *
 * - GET ?date=YYYY-MM-DD：列出该日待办（可省略 date 列全部）
 * - POST：{ date, text } 新增
 */
import type { APIRoute } from 'astro';
import { addTodo, listTodos } from '@/lib/calendar-data';
import { badJson, badRequest, json, readJson } from '@/lib/api';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET：列表（登录，中间件保护） */
export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date') ?? undefined;
  if (date && !DATE_RE.test(date)) return badRequest('日期格式不合法');
  const items = await listTodos(date);
  return json({ todos: items });
};

/** POST：新增（登录） */
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ date?: unknown; text?: unknown }>(request);
  if (!body) return badJson();
  const date = typeof body.date === 'string' ? body.date : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!DATE_RE.test(date)) return badRequest('日期格式不合法');
  if (!text) return badRequest('内容不能为空');
  const todo = await addTodo(date, text.slice(0, 500));
  return json({ todo });
};
