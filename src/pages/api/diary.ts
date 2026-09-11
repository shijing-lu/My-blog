/**
 * GET/POST /api/diary —— 日记（私密，登录；按日期 upsert）
 *
 * - GET ?date=YYYY-MM-DD：读取当日日记
 * - POST：{ date, title, content } 保存（upsert）
 */
import type { APIRoute } from 'astro';
import { getDiaryByDate, upsertDiary } from '@/lib/calendar-data';
import { badJson, badRequest, json, readJson } from '@/lib/api';
import { renderMarkdownHtml } from '@/lib/mdx';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET：读取当日日记（含渲染后的 HTML，供悬浮预览） */
export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date') ?? '';
  if (!DATE_RE.test(date)) return badRequest('日期格式不合法');
  const diary = await getDiaryByDate(date);
  if (!diary) return json({ diary: null });
  return json({
    diary: {
      id: diary.id,
      date: diary.date,
      title: diary.title,
      content: diary.content,
      contentHtml: await renderMarkdownHtml(diary.content),
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
  if (!DATE_RE.test(date)) return badRequest('日期格式不合法');
  const diary = await upsertDiary(date, title, content);
  return json({ diary: { id: diary.id, date: diary.date, title: diary.title, content: diary.content } });
};
