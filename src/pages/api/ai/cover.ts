import type { APIRoute } from 'astro';
import { guardTopAdmin, json, readJson } from '@/lib/api';
import { createArticleCover, applyArticleCover, CoverConflict } from '@/lib/ai-article-cover';
const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'private, no-store' } });
const running = new Set<string>();
export const prerender = false;
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = await guardTopAdmin(cookies); if (denied) return denied;
  const body = await readJson<{ id?: string; token?: string; baseline?: string }>(request);
  if (!body || typeof body.id !== 'string' || body.id.length > 160) return reply({ error: '文章 ID 不合法' }, 400);
  try {
    if (body.token !== undefined) {
      if (typeof body.token !== 'string' || body.token.length > 2048 || (body.baseline !== undefined && !/^[a-f0-9]{64}$/.test(body.baseline))) return reply({ error: '封面参数不合法' }, 400);
      return reply({ ok: true, ...(await applyArticleCover(body.id, body.token, body.baseline)) });
    }
    if (running.has(body.id)) return reply({ error: '这篇文章正在生成封面，请稍候' }, 409);
    running.add(body.id);
    try { return reply({ ok: true, ...(await createArticleCover(body.id, AbortSignal.timeout(240_000))) }); }
    finally { running.delete(body.id); }
  } catch (error) {
    if (error instanceof CoverConflict) return reply({ error: error.message, ...error.candidate }, 409);
    return reply({ error: error instanceof Error ? error.message : '封面生成失败' }, 400);
  }
};
