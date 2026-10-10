import type { APIRoute } from 'astro';
import { mobileError } from '@/lib/mobile-auth';
import { badJson, badRequest, json, readJson } from '@/lib/api';
import { cleanNoteTags, deleteQuickNote, getQuickNote, NOTE_MAX_CONTENT, NOTE_MAX_TITLE, toQuickNoteView, updateQuickNote } from '@/lib/quick-notes';

export const prerender = false;
const privateJson = (body: unknown) => json(body, { headers: { 'cache-control': 'private, no-store' } });
const notFound = () => json({ error: '记录不存在' }, { status: 404, headers: { 'cache-control': 'private, no-store' } });
const validId = (id: string | undefined) => !!id && /^[0-9a-f-]{36}$/i.test(id);

export const GET: APIRoute = async ({ params }) => {
  if (!validId(params.id)) return notFound();
  try {
    const note = await getQuickNote(params.id!);
    return note ? privateJson({ note: await toQuickNoteView(note) }) : notFound();
  } catch (error) { return mobileError(error); }
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (!validId(params.id)) return notFound();
  const body = await readJson<{ title?: unknown; content?: unknown; tags?: unknown; baseRevision?: unknown }>(request);
  if (!body) return badJson();
  if (typeof body.title !== 'string' || body.title.length > NOTE_MAX_TITLE) return badRequest('标题格式不合法');
  if (typeof body.content !== 'string' || body.content.length > NOTE_MAX_CONTENT || !body.content.trim()) return badRequest('正文不能为空或过长');
  const tags = cleanNoteTags(body.tags);
  if (!tags) return badRequest('标签格式不合法');
  if (body.baseRevision !== undefined && typeof body.baseRevision !== 'string') return badRequest('基线版本无效');
  try {
    const note = await updateQuickNote(params.id!, { title: body.title.trim(), content: body.content, tags }, body.baseRevision as string | undefined);
    return note ? privateJson({ note }) : notFound();
  } catch (error) { return mobileError(error); }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  if (!validId(params.id)) return notFound();
  try { return (await deleteQuickNote(params.id!, request.headers.get('if-match') ?? undefined)) ? privateJson({ ok: true }) : notFound(); }
  catch (error) { return mobileError(error); }
};
