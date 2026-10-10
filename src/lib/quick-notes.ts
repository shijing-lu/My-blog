/** 随心录：独立的私密记录，不与公开动态或按日覆盖的日记共表。 */
import { randomUUID } from 'node:crypto';
import { and, desc, gte, lt, sql } from 'drizzle-orm';
import { quickNotes } from '../../db/schema.sqlite';
import { db } from '../../db';
import { renderMomentContent } from './moments';
import { mobileSyncStore, type SyncRecord, type NotePayload } from './mobile-sync-store';
import { MobileAuthError } from './mobile-auth-core';

export const NOTE_MAX_CONTENT = 20_000;
export const NOTE_MAX_TITLE = 120;
export const NOTE_MAX_TAGS = 10;
export const NOTE_MAX_TAG_LENGTH = 20;

export type QuickNote = Omit<typeof quickNotes.$inferSelect, 'tags'> & { tags: string[]; syncRevision?: string };

export function cleanNoteTags(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > NOTE_MAX_TAGS || input.some((v) => typeof v !== 'string')) return null;
  const clean = [...new Set(input.map((v: string) => v.trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (clean.some((v) => v.length > NOTE_MAX_TAG_LENGTH)) return null;
  return clean;
}

function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function fromRow(row: typeof quickNotes.$inferSelect): QuickNote {
  return { ...row, tags: parseTags(row.tags) };
}

export interface NoteFilter {
  tag?: string;
  month?: string;
}

function conditions(filter: NoteFilter) {
  const parts = [];
  if (filter.tag) {
    const encoded = JSON.stringify(filter.tag).replace(/[\\%_]/g, '\\$&');
    parts.push(sql`${quickNotes.tags} LIKE ${`%${encoded}%`} ESCAPE '\\'`);
  }
  if (filter.month) {
    const [year, month] = filter.month.split('-').map(Number);
    const start = new Date(Date.UTC(year!, month! - 1, 1) - 8 * 60 * 60 * 1000);
    const end = new Date(Date.UTC(year!, month!, 1) - 8 * 60 * 60 * 1000);
    parts.push(gte(quickNotes.createdAt, start), lt(quickNotes.createdAt, end));
  }
  return parts.length ? and(...parts) : undefined;
}

export async function listQuickNotes(limit: number, offset: number, filter: NoteFilter = {}) {
  const where = conditions(filter);
  const rows = await db.select().from(quickNotes).where(where)
    .orderBy(desc(quickNotes.createdAt), desc(quickNotes.id)).limit(limit).offset(offset);
  const countRows = await db.select({ count: sql<number>`count(*)` }).from(quickNotes).where(where);
  return { notes: rows.map(fromRow), total: Number(countRows[0]?.count ?? 0) };
}

/** 全量筛选元数据；仅站主端调用。 */
export async function getQuickNoteFacets() {
  const rows = await db.select({ tags: quickNotes.tags, createdAt: quickNotes.createdAt }).from(quickNotes)
    .orderBy(desc(quickNotes.createdAt));
  const tagCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  const monthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' });
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const parts = monthFmt.formatToParts(row.createdAt);
    const month = `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }
  return {
    tags: [...tagCounts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    months: [...monthCounts].map(([name, count]) => ({ name, count })),
  };
}

export async function getQuickNote(id: string): Promise<QuickNote | null> {
  const record = await getVersion(id);
  return record?.payload ? fromVersion(record) : null;
}

async function getVersion(id: string): Promise<SyncRecord | undefined> {
  let cursor = 0;
  do {
    const page = await mobileSyncStore().sync([], cursor);
    const record = page.records.find(r => r.recordId === id);
    if (record) return record;
    if (!page.hasMore) return undefined;
    cursor = Number(page.cursor);
  } while (true);
}
function fromVersion(record: SyncRecord): QuickNote {
  const n = record.payload!;
  return { id: record.recordId, title: n.title, content: n.content, tags: n.tags, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt), syncRevision: record.revision };
}
async function writeVersion(id: string, baseRevision: string | null, payload: NotePayload | null): Promise<SyncRecord> {
  const result = await mobileSyncStore().sync([{ opId: randomUUID(), recordId: id, baseRevision, payload }], 0);
  const ack = result.acknowledgements[0]!;
  if (ack.status === 'conflict') throw new MobileAuthError(409, 'note_conflict', '这条随心录已在其他设备修改。输入已保留，请先复制本地内容再重新打开核对');
  return ack.record;
}

export async function createQuickNote(input: { title: string; content: string; tags: string[] }): Promise<QuickNote> {
  const now = Date.now();
  return fromVersion(await writeVersion(randomUUID(), null, { ...input, createdAt: now, updatedAt: now }));
}

export async function updateQuickNote(id: string, input: { title: string; content: string; tags: string[] }, baseRevision?: string): Promise<QuickNote | null> {
  const old = await getVersion(id);
  if (!old?.payload) return null;
  return fromVersion(await writeVersion(id, baseRevision ?? old.revision, { ...input, createdAt: old.payload.createdAt, updatedAt: Math.max(Date.now(), old.payload.createdAt) }));
}

export async function deleteQuickNote(id: string, baseRevision?: string): Promise<boolean> {
  const old = await getVersion(id);
  if (!old?.payload) return false;
  await writeVersion(id, baseRevision ?? old.revision, null);
  return true;
}

export async function toQuickNoteView(note: QuickNote) {
  return { ...note, contentHtml: await renderMomentContent(note.content) };
}
