/**
 * POST /api/doc/nodes —— 新建文档节点（目录 folder / 文章 article，管理员）
 *
 * body: { bundleId, parentId?, kind: 'folder'|'article', title, content? }
 */
import type { APIRoute } from 'astro';
import { createDocNode, getBundle } from '@/lib/docs';
import { json } from '@/lib/api';

export const prerender = false;

const MAX_TITLE = 200;
const MAX_CONTENT = 500000;

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const bundleId = typeof body.bundleId === 'string' ? body.bundleId : '';
  const kind = body.kind === 'folder' ? 'folder' : body.kind === 'article' ? 'article' : null;
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
  const parentId = typeof body.parentId === 'string' && body.parentId !== '' ? body.parentId : null;

  if (!bundleId || !kind) return json({ error: '缺少 bundleId / kind' }, 400);
  if (!title) return json({ error: '标题不能为空' }, 400);
  if (kind === 'article' && content === '') return json({ error: '文章正文不能为空' }, 400);
  const bundle = await getBundle(bundleId);
  if (!bundle) return json({ error: '文档不存在' }, 404);

  try {
    // 新节点排在同级末尾
    const siblings = await import('@/lib/docs').then((m) => m.listBundleNodes(bundleId));
    const sameLevel = siblings.filter((n) => (n.parentId ?? null) === parentId);
    const sort = sameLevel.length > 0 ? Math.max(...sameLevel.map((n) => n.sort)) + 1 : 0;
    const node = await createDocNode({ bundleId, parentId, kind, title, content, sort });
    return json({ node }, 201);
  } catch (err) {
    console.error('[api/doc/nodes]', err);
    return json({ error: '创建失败' }, 500);
  }
};
