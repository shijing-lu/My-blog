/**
 * GET/PATCH/DELETE /api/doc/nodes/[id] —— 文档节点（管理员写；GET 供编辑回显）
 *
 * - GET：单节点（含 content）
 * - PATCH：更新 title / content / parentId / sort
 * - DELETE：删除节点（级联子孙）
 */
import type { APIRoute } from 'astro';
import { deleteDocNode, getDocNode, updateDocNode } from '@/lib/docs';
import { json } from '@/lib/api';

export const prerender = false;

const MAX_TITLE = 200;
const MAX_CONTENT = 500000;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const node = await getDocNode(id);
  if (!node) return json({ error: '节点不存在' }, 404);
  return json({ node });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const patch: { title?: string; content?: string; parentId?: string | null; sort?: number } = {};
  if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, MAX_TITLE);
  if (typeof body.content === 'string') patch.content = body.content.slice(0, MAX_CONTENT);
  if (body.parentId !== undefined) patch.parentId = typeof body.parentId === 'string' && body.parentId !== '' ? body.parentId : null;
  if (typeof body.sort === 'number' && Number.isFinite(body.sort)) patch.sort = Math.floor(body.sort);
  if (Object.keys(patch).length === 0) return json({ error: '没有可更新字段' }, 400);
  const node = await updateDocNode(id, patch);
  if (!node) return json({ error: '节点不存在' }, 404);
  return json({ node });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const node = await deleteDocNode(id);
  if (!node) return json({ error: '节点不存在' }, 404);
  return json({ ok: true });
};
