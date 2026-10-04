import type { APIRoute } from 'astro';
import { badJson, badRequest, json, notFound, readJson } from '@/lib/api';
import { cleanNoteTags, deleteQuickNote, getQuickNote, NOTE_MAX_CONTENT, NOTE_MAX_TITLE, toQuickNoteView, updateQuickNote } from '@/lib/quick-notes';

export const prerender = false;
const privateJson = (body: unknown) => json(body, { headers: { 'cache-control': 'private, no-store' } });
const validId = (id: string | undefined) => !!id && /^[0-9a-f-]{36}$/i.test(id);

export const GET: APIRoute = async ({ params }) => {
  if (!validId(params.id)) return notFound();
  const note = await getQuickNote(params.id!);
  return note ? privateJson({ note: await toQuickNoteView(note) }) : notFound();
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (!validId(params.id)) return notFound();
  const body = await readJson<{ title?: unknown; content?: unknown; tags?: unknown }>(request);
  if (!body) return badJson();
  if (typeof body.title !== 'string' || body.title.length > NOTE_MAX_TITLE) return badRequest('标题格式不合法');
  if (typeof body.content !== 'string' || body.content.length > NOTE_MAX_CONTENT || !body.content.trim()) return badRequest('正文不能为空或过长');
  const tags = cleanNoteTags(body.tags);
  if (!tags) return badRequest('标签格式不合法');
  const note = await updateQuickNote(params.id!, { title: body.title.trim(), content: body.content, tags });
  return note ? privateJson({ note }) : notFound();
};

export const DELETE: APIRoute = async ({ params }) => {
  if (!validId(params.id)) return notFound();
  return (await deleteQuickNote(params.id!)) ? privateJson({ ok: true }) : notFound();
};
