import type { APIRoute } from 'astro';
import { badJson, badRequest, json, readJson } from '@/lib/api';
import { renderMomentContent } from '@/lib/moments';
import { NOTE_MAX_CONTENT } from '@/lib/quick-notes';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ source?: unknown }>(request);
  if (!body) return badJson();
  if (typeof body.source !== 'string' || body.source.length > NOTE_MAX_CONTENT) return badRequest('正文格式不合法或过长');
  const html = await renderMomentContent(body.source);
  return json({ html }, { headers: { 'cache-control': 'private, no-store' } });
};
