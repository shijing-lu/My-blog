/**
 * GET /api/study/checkin/tasks/[id]/records —— 某任务打卡记录（私密，登录）
 *
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD：返回该范围内已打卡日期数组
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getCheckedDates } from '@/lib/checkin-data';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return json({ error: '缺少有效的日期范围' }, 400);
  }
  try {
    const dates = await getCheckedDates(id, new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`));
    return json({ dates });
  } catch (err) {
    console.error('[api/study/checkin/records]', err);
    return json({ error: '读取失败' }, 500);
  }
};
