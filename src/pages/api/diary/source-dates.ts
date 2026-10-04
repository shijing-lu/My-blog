import type { APIRoute } from 'astro';
import { isTopAdmin } from '@/lib/admin-auth';
import { json } from '@/lib/api';
import { listMissingSourceDates, shanghaiDateKey } from '@/lib/diary-log';

export const prerender = false;
const reply = (body: unknown, status = 200) => json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isTopAdmin(cookies))) return reply({ error: '无权操作' }, 403);
  try {
    return reply({ dates: await listMissingSourceDates(), today: shanghaiDateKey() });
  } catch (error) {
    console.error('[api/diary/source-dates]', error);
    return reply({ error: '读取来源日期失败' }, 500);
  }
};
