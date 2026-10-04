/**
 * GET/POST /api/diary —— 日记（私密，登录；按日期 upsert）
 *
 * - GET ?date=YYYY-MM-DD：读取当日日记
 * - POST：{ date, title, content } 保存（upsert）
 */
import type { APIRoute } from 'astro';
import { createDiaryIfMissing, getDiaryByDate, upsertDiary } from '@/lib/calendar-data';
import { badJson, badRequest, json, readJson } from '@/lib/api';
import { renderMomentContent } from '@/lib/moments';
import { isValidDiaryDate } from '@/lib/diary-log';

export const prerender = false;

const privateJson = (body: unknown, status = 200) => json(body, { status, headers: { 'cache-control': 'private, no-store' } });

/** GET：读取当日日记（含渲染后的 HTML，供悬浮预览） */
export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date') ?? '';
  if (!isValidDiaryDate(date)) return badRequest('日期格式不合法');
  const diary = await getDiaryByDate(date);
  if (!diary) return privateJson({ diary: null });
  return privateJson({
    diary: {
      id: diary.id,
      date: diary.date,
      title: diary.title,
      content: diary.content,
      contentHtml: await renderMomentContent(diary.content),
    },
  });
};

/** POST：保存（upsert） */
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ date?: unknown; title?: unknown; content?: unknown }>(request);
  if (!body) return badJson();
  const date = typeof body.date === 'string' ? body.date : '';
  const title = typeof body.title === 'string' ? body.title.slice(0, 200) : '';
  const content = typeof body.content === 'string' ? body.content.slice(0, 100000) : '';
  if (!isValidDiaryDate(date)) return badRequest('日期格式不合法');
  const diary = await upsertDiary(date, title, content);
  return privateJson({ diary: { id: diary.id, date: diary.date, title: diary.title, content: diary.content } });
};

/** PUT：首次打开空日期时原子创建，不覆盖并发写入的内容。 */
export const PUT: APIRoute = async ({ request }) => {
  const body = await readJson<{ date?: unknown }>(request);
  if (!body) return badJson();
  const date = typeof body.date === 'string' ? body.date : '';
  if (!isValidDiaryDate(date)) return badRequest('日期格式不合法');
  const created = await createDiaryIfMissing(date, `${date} 日记`, '');
  return privateJson({ created });
};
