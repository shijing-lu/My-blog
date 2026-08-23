/**
 * GET/POST /api/todos —— 待办（私密，全部需登录）
 *
 * - GET ?date=YYYY-MM-DD：列出该日待办（可省略 date 列全部）
 * - POST：{ date, text } 新增
 */
import type { APIRoute } from 'astro';
import { addTodo, listTodos } from '@/lib/calendar-data';
import { json } from '@/lib/api';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET：列表（登录，中间件保护） */
export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date') ?? undefined;
  if (date && !DATE_RE.test(date)) return json({ error: '日期格式不合法' }, 400);
  const items = await listTodos(date);
  return json({ todos: items });
};

/** POST：新增（登录） */
export const POST: APIRoute = async ({ request }) => {
  let body: { date?: unknown; text?: unknown };
  try {
    body = (await request.json()) as { date?: unknown; text?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const date = typeof body.date === 'string' ? body.date : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!DATE_RE.test(date)) return json({ error: '日期格式不合法' }, 400);
  if (!text) return json({ error: '内容不能为空' }, 400);
  const todo = await addTodo(date, text.slice(0, 500));
  return json({ todo });
};
