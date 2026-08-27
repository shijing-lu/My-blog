/**
 * POST /api/study/checkin/toggle —— 打卡/取消打卡（私密，登录）
 *
 * body: { taskId, date }  date=YYYY-MM-DD（今天或补签日）
 * 返回 { checked: true|false }（true=已打卡 false=已取消）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { toggleCheckin } from '@/lib/checkin-data';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const POST: APIRoute = async ({ request }) => {
  let body: { taskId?: unknown; date?: unknown };
  try {
    body = (await request.json()) as { taskId?: unknown; date?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const taskId = typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : '';
  const date = typeof body.date === 'string' ? body.date : '';
  if (!taskId) return json({ error: '缺少任务 ID' }, 400);
  if (!DATE_RE.test(date)) return json({ error: '日期格式不合法' }, 400);
  try {
    const checked = await toggleCheckin(taskId, date);
    return json({ checked });
  } catch (err) {
    console.error('[api/study/checkin/toggle]', err);
    const msg = err instanceof Error && err.message.includes('补签') ? err.message : '打卡失败';
    return json({ error: msg }, 400);
  }
};
