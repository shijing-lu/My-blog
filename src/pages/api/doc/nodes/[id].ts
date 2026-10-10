/**
 * GET/PATCH/DELETE /api/doc/nodes/[id] —— 文档节点（管理员写；GET 供编辑回显）
 *
 * - GET：单节点（含 content）
 * - PATCH：更新 title / content / parentId / sort
 * - DELETE：删除节点（级联子孙）
 */
import type { APIRoute } from 'astro';
import { deleteDocNode, getDocNode, updateDocNode } from '@/lib/docs';
import { badJson, badRequest, json, missing, notFound, readJson } from '@/lib/api';
import { contentVersion } from '@/lib/article-content-version';
import { db } from '../../../../../db';
import { docNodes } from '../../../../../db/schema.sqlite';
import { and, eq } from 'drizzle-orm';

export const prerender = false;

const MAX_TITLE = 200;
const MAX_CONTENT = 500000;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  const node = await getDocNode(id);
  if (!node) return notFound('节点不存在');
  return json({ node, contentHash: contentVersion(node.content) });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return missing('id');
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  const patch: { title?: string; content?: string; parentId?: string | null; sort?: number } = {};
  if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, MAX_TITLE);
  if (typeof body.content === 'string') {
    if(body.content.length>MAX_CONTENT)return badRequest('正文超过500000字，未截断或保存');
    patch.content = body.content;
  }
  if (body.parentId !== undefined) patch.parentId = typeof body.parentId === 'string' && body.parentId !== '' ? body.parentId : null;
  if (typeof body.sort === 'number' && Number.isFinite(body.sort)) patch.sort = Math.floor(body.sort);
  if (Object.keys(patch).length === 0) return badRequest('没有可更新字段');
  let node;
  if(patch.content!==undefined && body.expectedContentHash!==undefined) {
    const original=await getDocNode(id);if(!original)return notFound('节点不存在');
    if(body.expectedContentHash!==contentVersion(original.content)) {
      if(patch.content===original.content&&Object.keys(patch).length===1)return json({node:original,contentHash:contentVersion(original.content)});
      return json({error:'正文已变化，当前修改未覆盖'},409);
    }
    [node]=await db.update(docNodes).set({...patch,updatedAt:new Date()}).where(and(eq(docNodes.id,id),eq(docNodes.content,original.content))).returning();
    if(!node)return json({error:'正文已变化，当前修改未覆盖'},409);
  }else node = await updateDocNode(id, patch);
  if (!node) return notFound('节点不存在');
  return json({ node, contentHash: contentVersion(node.content) });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return missing('id');
  const node = await deleteDocNode(id);
  if (!node) return notFound('节点不存在');
  return json({ ok: true });
};
