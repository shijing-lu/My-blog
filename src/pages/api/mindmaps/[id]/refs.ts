/**
 * POST /api/mindmaps/[id]/refs —— 往导图追加「片段引用」节点（管理员）
 *
 * body: { text, anchorId, snippet, parentId? }
 *   - text：节点文本（文章片段摘要）
 *   - anchorId：文章段落锚点（para-N）
 *   - snippet：原文片段（失效兜底定位）
 *   - parentId：目标父节点 uid（省略/空 → 追加到根节点）
 * → 200 { map: { id, updatedAt } }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { addMindmapRefNode, getMindmap, parseMindmapData, stringifyMindmapData, updateMindmap } from '@/lib/mindmaps';

export const prerender = false;

const MAX_TEXT = 80;
const MAX_SNIPPET = 500;

export const POST: APIRoute = async ({ params, request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  const id = params.id ?? '';
  let body: { text?: unknown; anchorId?: unknown; snippet?: unknown; parentId?: unknown };
  try {
    body = (await request.json()) as { text?: unknown; anchorId?: unknown; snippet?: unknown; parentId?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const anchorId = typeof body.anchorId === 'string' ? body.anchorId.trim() : '';
  const snippet = typeof body.snippet === 'string' ? body.snippet.trim() : '';
  if (!text || !anchorId) return json({ error: '缺少片段文本或锚点' }, 400);
  const parentId = typeof body.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : null;

  try {
    const map = await getMindmap(id);
    if (!map) return json({ error: '思维导图不存在' }, 404);
    const data = parseMindmapData(map.data);
    const next = addMindmapRefNode(data, {
      parentId,
      text: text.slice(0, MAX_TEXT),
      anchorId,
      snippet: snippet.slice(0, MAX_SNIPPET),
    });
    const updated = await updateMindmap(id, { data: stringifyMindmapData(next) });
    return json({ map: { id, updatedAt: updated?.updatedAt.toISOString() } });
  } catch (err) {
    console.error('[api/mindmaps/refs]', err);
    return json({ error: '添加引用失败' }, 500);
  }
};
