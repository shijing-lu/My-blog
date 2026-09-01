/**
 * PATCH /api/photos/batch-tags —— 批量维护照片标签（管理员，中间件保护）
 *
 * body: { ids: string[], op: 'set'|'add'|'remove', tags: string[] }
 * - set：覆盖为给定标签（空数组 = 清空）
 * - add：合并追加
 * - remove：减去给定标签
 */
import type { APIRoute } from 'astro';
import { batchUpdateTags } from '@/lib/photos';
import { json } from '@/lib/api';

export const prerender = false;

export const PATCH: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) return json({ error: '请选择照片' }, 400);
  if (ids.length > 200) return json({ error: '单次最多 200 张' }, 400);
  const op = body.op === 'add' || body.op === 'remove' ? body.op : 'set';
  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  try {
    const updated = await batchUpdateTags(ids, op, tags);
    return json({ ok: true, updated });
  } catch (err) {
    console.error('[api/photos/batch-tags]', err);
    return json({ error: '操作失败' }, 500);
  }
};
