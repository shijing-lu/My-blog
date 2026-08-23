/**
 * DELETE /api/moments/[id] —— 删除动态（管理员）
 */
import type { APIRoute } from 'astro';
import { deleteMoment } from '@/lib/moments';
import { json } from '@/lib/api';

export const prerender = false;

/** DELETE */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const moment = await deleteMoment(id);
  if (!moment) return json({ error: '动态不存在' }, 404);
  return json({ ok: true });
};
