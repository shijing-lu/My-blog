/**
 * DELETE /api/study/distractions/[id] —— 删除打断记录（私密，登录）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { deleteStudyDistraction } from '@/lib/study-data';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  try {
    const item = await deleteStudyDistraction(id);
    if (!item) return json({ error: '记录不存在' }, 404);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/study/distractions]', err);
    return json({ error: '删除失败' }, 500);
  }
};
