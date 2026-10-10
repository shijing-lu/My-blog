import type { APIRoute } from 'astro';
import { mobileError } from '@/lib/mobile-auth';
import { badJson, badRequest, json, readJson } from '@/lib/api';
import { cleanNoteTags, createQuickNote, getQuickNoteFacets, listQuickNotes, NOTE_MAX_CONTENT, NOTE_MAX_TITLE, toQuickNoteView } from '@/lib/quick-notes';

export const prerender = false;
const privateJson = (body: unknown, status = 200) => json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export const GET: APIRoute = async ({ url }) => {
  const limitRaw = Number(url.searchParams.get('limit') ?? 20);
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(30, Math.floor(limitRaw))) : 20;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  const month = url.searchParams.get('month') ?? '';
  const tag = url.searchParams.get('tag') ?? '';
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest('月份格式不合法');
  if (tag.length > 20) return badRequest('标签过长');
  const [{ notes, total }, facets] = await Promise.all([
    listQuickNotes(limit, offset, { month: month || undefined, tag: tag || undefined }),
    getQuickNoteFacets(),
  ]);
  return privateJson({ notes: await Promise.all(notes.map(toQuickNoteView)), total, facets });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ title?: unknown; content?: unknown; tags?: unknown }>(request);
  if (!body) return badJson();
  if (typeof body.title !== 'string' || body.title.length > NOTE_MAX_TITLE) return badRequest('标题格式不合法');
  if (typeof body.content !== 'string' || body.content.length > NOTE_MAX_CONTENT || !body.content.trim()) return badRequest('正文不能为空或过长');
  const tags = cleanNoteTags(body.tags);
  if (!tags) return badRequest('标签格式不合法');
  try {
    const note = await createQuickNote({ title: body.title.trim(), content: body.content, tags });
    return privateJson({ note }, 201);
  } catch (error) { return mobileError(error); }
};
