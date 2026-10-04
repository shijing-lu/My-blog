import type { APIRoute } from 'astro';
import { isTopAdmin } from '@/lib/admin-auth';
import { json, readJson } from '@/lib/api';
import { generateDiary, isValidDiaryDate, shanghaiDateKey } from '@/lib/diary-log';

export const prerender = false;
const reply = (body: unknown, status = 200) => json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies))) return reply({ error: '无权操作' }, 403);
  const body = await readJson<{ date?: unknown; mode?: unknown }>(request);
  if (!body || typeof body.date !== 'string' || !isValidDiaryDate(body.date) || body.date > shanghaiDateKey()) {
    return reply({ error: '日期不合法' }, 400);
  }
  if (body.mode !== 'missing' && body.mode !== 'replace') return reply({ error: '生成模式不合法' }, 400);
  if (body.mode === 'replace' && body.date !== shanghaiDateKey()) return reply({ error: '仅可覆盖生成当日日志' }, 400);
  try {
    return reply(await generateDiary(body.date, body.mode, request.signal));
  } catch (error) {
    console.error('[api/diary/generate]', error);
    return reply({ error: error instanceof Error ? error.message : '生成日志失败' }, 502);
  }
};
