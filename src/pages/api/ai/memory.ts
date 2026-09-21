/**
 * /api/ai/memory —— 记忆管理（仅站主）
 *
 * - GET          列表（按重要度/新鲜度排序），供「记忆」弹窗与设置页展示
 * - PATCH        { id, content?, importance? } 修改单条（改内容同样走脱敏）
 * - DELETE       ?id=xxx 删除单条；?all=1 全部清空（站主的"忘记我"）
 *
 * 权限：isTopAdmin 服务端判定——管理员与游客一律 403（前端隐藏只是体验，不是安全边界）。
 */
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { dbWrite } from '../../../../db';
import { aiMemories } from '../../../../db/schema.sqlite';
import { forbidden, json, readJson } from '@/lib/api';
import { isTopAdmin } from '@/lib/admin-auth';
import { ensureAiTables } from '@/lib/ai-store';
import { cleanDraft, clearMemories, deleteMemory, listMemories } from '@/lib/ai-memory';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isTopAdmin(cookies))) return forbidden('记忆功能仅对站主开放');
  if (!(await ensureAiTables())) return json({ ok: false, error: '数据层不可用' }, 503);
  const memories = await listMemories();
  return json({
    ok: true,
    memories: memories.map((m) => ({
      id: m.id,
      kind: m.kind,
      content: m.content,
      importance: m.importance,
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies))) return forbidden('记忆功能仅对站主开放');
  const body = await readJson<{ id?: string; content?: string; importance?: number }>(request);
  if (!body || typeof body.id !== 'string' || body.id.trim() === '') {
    return json({ error: '缺少 id' }, 400);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.content === 'string') {
    // 复用草稿清洗：脱敏 + 截断；整条敏感则拒绝（保留原值）
    const cleaned = cleanDraft({ kind: 'fact', content: body.content, importance: 3 });
    if (!cleaned) return json({ error: '内容为空或全部为敏感信息（已拒绝写入）' }, 400);
    patch.content = cleaned.content;
  }
  if (typeof body.importance === 'number' && Number.isFinite(body.importance)) {
    patch.importance = Math.min(5, Math.max(1, Math.round(body.importance)));
  }

  try {
    await dbWrite(async (d) => d.update(aiMemories).set(patch).where(eq(aiMemories.id, body.id!)));
    return json({ ok: true });
  } catch (err) {
    console.error('[api/ai/memory] PATCH 失败:', (err as Error).message);
    return json({ ok: false, error: '更新失败' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies))) return forbidden('记忆功能仅对站主开放');
  const url = new URL(request.url);

  if (url.searchParams.get('all') === '1') {
    const ok = await clearMemories();
    return json({ ok }, ok ? 200 : 500);
  }

  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id) return json({ error: '缺少 id 或 all=1' }, 400);
  const ok = await deleteMemory(id);
  return json({ ok }, ok ? 200 : 500);
};
