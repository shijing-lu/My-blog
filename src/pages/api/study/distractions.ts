/**
 * GET/POST /api/study/distractions —— 打断记录（私密，登录）
 *
 * - GET：列表（新 → 旧）
 * - POST：{ type: 'internal'|'external', note? } 记录
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { addStudyDistraction, listStudyDistractions } from '@/lib/study-data';

export const prerender = false;

const MAX_NOTE = 300;

/** GET：打断列表（登录） */
export const GET: APIRoute = async () => {
  try {
    const items = await listStudyDistractions();
    return json({ distractions: items });
  } catch (err) {
    console.error('[api/study/distractions]', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** POST：记录打断（登录） */
export const POST: APIRoute = async ({ request }) => {
  let body: { type?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { type?: unknown; note?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const type = body.type === 'internal' || body.type === 'external' ? body.type : '';
  if (!type) return json({ error: '打断类型不合法' }, 400);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
  try {
    const item = await addStudyDistraction({ type, note });
    return json({ distraction: item }, 201);
  } catch (err) {
    console.error('[api/study/distractions]', err);
    return json({ error: '记录失败' }, 500);
  }
};
