/**
 * PUT /api/study/goal —— 设置每日目标番茄数（私密，登录）
 *
 * body: { value: number }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { setDailyGoal } from '@/lib/study-data';

export const prerender = false;

export const PUT: APIRoute = async ({ request }) => {
  let body: { value?: unknown };
  try {
    body = (await request.json()) as { value?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 0 || value > 99) return json({ error: '目标不合法' }, 400);
  try {
    await setDailyGoal(value);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/study/goal]', err);
    return json({ error: '保存失败' }, 500);
  }
};
