import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import postgres from 'postgres';
import { readDatabaseUrl, isPostgresUrl } from '../../db/dialect';
import { MobileAuthError } from './mobile-auth-core';

export const MOBILE_SYNC_DDL = `
CREATE TABLE IF NOT EXISTS mobile_sync_head (id text PRIMARY KEY NOT NULL, seq integer NOT NULL);
CREATE TABLE IF NOT EXISTS mobile_sync_records (id text PRIMARY KEY NOT NULL, revision text NOT NULL, seq integer NOT NULL, payload text);
CREATE INDEX IF NOT EXISTS mobile_sync_records_seq ON mobile_sync_records(seq);
CREATE TABLE IF NOT EXISTS mobile_sync_receipts (id text PRIMARY KEY NOT NULL, digest text NOT NULL, reply text NOT NULL);
INSERT INTO mobile_sync_head(id,seq) VALUES ('quick_notes',0) ON CONFLICT(id) DO NOTHING;`;
export interface NotePayload { title: string; content: string; tags: string[]; createdAt: number; updatedAt: number }
export interface SyncRecord { recordId: string; revision: string; seq: number; payload: NotePayload | null }
export interface SyncOperation { opId: string; recordId: string; baseRevision: string | null; payload: NotePayload | null }
export interface SyncAck { opId: string; status: 'accepted' | 'conflict'; record: SyncRecord }
export interface SyncResult { protocolVersion: 1; acknowledgements: SyncAck[]; records: SyncRecord[]; cursor: string; hasMore: boolean }
type Row = Record<string, unknown>;
interface Snapshot { seq: number; records: SyncRecord[]; notes: Row[]; receipts: Row[] }
const decodeRecord = (r: Row): SyncRecord => ({ recordId: String(r.id), revision: String(r.revision), seq: Number(r.seq), payload: r.payload === null ? null : JSON.parse(String(r.payload)) });
const canonical = (p: NotePayload | null) => p === null ? 'null' : JSON.stringify([p.title, p.content, p.tags, p.createdAt, p.updatedAt]);
const millis = (v: unknown) => v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(String(v)).getTime();
function rawNote(row: Row): NotePayload {
  const tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags;
  return { title: String(row.title), content: String(row.content), tags, createdAt: millis(row.created_at), updatedAt: millis(row.updated_at) };
}
function digest(operation: SyncOperation) { return createHash('sha256').update(JSON.stringify([operation.recordId, operation.baseRevision, canonical(operation.payload)])).digest('hex'); }
export function validateOperation(value: unknown): SyncOperation {
  const o = value as SyncOperation;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!o || !uuid.test(o.opId) || !uuid.test(o.recordId) || !(o.baseRevision === null || typeof o.baseRevision === 'string' && uuid.test(o.baseRevision))) throw new MobileAuthError(400, 'invalid_operation', '操作标识或版本无效');
  if (o.payload !== null) {
    const p = o.payload;
    if (!p || typeof p.title !== 'string' || p.title.length > 120 || typeof p.content !== 'string' || !p.content.trim() || p.content.length > 20000 || !Array.isArray(p.tags) || p.tags.length > 10 || p.tags.some(t => typeof t !== 'string' || t.length > 20) || !Number.isSafeInteger(p.createdAt) || !Number.isSafeInteger(p.updatedAt) || p.createdAt < 0 || p.updatedAt < p.createdAt || p.updatedAt > Date.now() + 86400000) throw new MobileAuthError(400, 'invalid_payload', '随心录字段无效或超过限制');
  }
  return { opId: o.opId, recordId: o.recordId, baseRevision: o.baseRevision, payload: o.payload === null ? null : { title: o.payload.title, content: o.payload.content, tags: o.payload.tags, createdAt: o.payload.createdAt, updatedAt: o.payload.updatedAt } };
}
function plan(snapshot: Snapshot, operations: SyncOperation[], cursor: number) {
  let seq = snapshot.seq;
  const records = new Map(snapshot.records.map(r => [r.recordId, r]));
  const changed = new Map<string, SyncRecord>();
  const receipts: Row[] = [], writes: SyncRecord[] = [], acknowledgements: SyncAck[] = [];
  const add = (id: string, payload: NotePayload | null) => {
    const r: SyncRecord = { recordId: id, payload, revision: randomUUID(), seq: ++seq };
    records.set(id, r); changed.set(id, r); return r;
  };
  // Captures imported/legacy desktop changes and permanent deletions before testing mobile baselines.
  const source = new Map(snapshot.notes.map(r => [String(r.id), rawNote(r)]));
  for (const [id, payload] of source) if (canonical(records.get(id)?.payload ?? null) !== canonical(payload)) add(id, payload);
  for (const r of [...records.values()]) if (r.payload !== null && !source.has(r.recordId)) add(r.recordId, null);
  const previous = new Map(snapshot.receipts.map(r => [String(r.id), r]));
  for (const operation of operations) {
    const oldReceipt = previous.get(operation.opId);
    if (oldReceipt) {
      if (oldReceipt.digest !== digest(operation)) throw new MobileAuthError(409, 'operation_reused', '同一操作标识不能用于不同修改');
      acknowledgements.push(JSON.parse(String(oldReceipt.reply))); continue;
    }
    const old = records.get(operation.recordId);
    const matches = (old?.revision ?? null) === operation.baseRevision;
    const record = matches ? add(operation.recordId, operation.payload) : old ?? { recordId: operation.recordId, revision: '', seq: 0, payload: null };
    if (matches) writes.push(record);
    const ack: SyncAck = { opId: operation.opId, status: matches ? 'accepted' : 'conflict', record };
    acknowledgements.push(ack);
    receipts.push({ id: operation.opId, digest: digest(operation), reply: JSON.stringify(ack) });
  }
  const page = [...records.values()].filter(r => r.seq > cursor).sort((a, b) => a.seq - b.seq).slice(0, 100);
  const end = page.at(-1)?.seq ?? seq;
  const result: SyncResult = { protocolVersion: 1, acknowledgements, records: page, cursor: String(end), hasMore: [...records.values()].some(r => r.seq > end) };
  return { seq, changed: [...changed.values()], receipts, writes, result };
}
export interface MobileSyncStore { sync(operations: SyncOperation[], cursor: number): Promise<SyncResult>; close(): Promise<void> }
const requireHere = createRequire(import.meta.url);
export function createSqliteMobileSyncStore(file: string): MobileSyncStore {
  const ctor = requireHere('better-sqlite3') as typeof Database;
  const db = new ctor(file); db.pragma('busy_timeout = 5000'); db.pragma('journal_mode = WAL'); db.exec(MOBILE_SYNC_DDL);
  const execute = db.transaction((operations: SyncOperation[], cursor: number) => {
    const snapshot: Snapshot = { seq: Number((db.prepare("SELECT seq FROM mobile_sync_head WHERE id='quick_notes'").get() as Row).seq), records: (db.prepare('SELECT * FROM mobile_sync_records').all() as Row[]).map(decodeRecord), notes: db.prepare('SELECT * FROM quick_notes').all() as Row[], receipts: operations.flatMap(o => { const row = db.prepare('SELECT * FROM mobile_sync_receipts WHERE id=?').get(o.opId); return row ? [row as Row] : []; }) };
    if (cursor > snapshot.seq) throw new MobileAuthError(409, 'cursor_invalid', '同步游标超过服务端版本，请保留本地副本并重新获取');
    const p = plan(snapshot, operations, cursor);
    for (const r of p.changed) db.prepare('INSERT INTO mobile_sync_records(id,revision,seq,payload) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,seq=excluded.seq,payload=excluded.payload').run(r.recordId, r.revision, r.seq, r.payload === null ? null : JSON.stringify(r.payload));
    for (const r of p.writes) {
      if (!r.payload) db.prepare('DELETE FROM quick_notes WHERE id=?').run(r.recordId);
      else { const n = r.payload; db.prepare('INSERT INTO quick_notes(id,title,content,tags,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,tags=excluded.tags,created_at=excluded.created_at,updated_at=excluded.updated_at').run(r.recordId, n.title, n.content, JSON.stringify(n.tags), n.createdAt, n.updatedAt); }
    }
    for (const r of p.receipts) db.prepare('INSERT INTO mobile_sync_receipts(id,digest,reply) VALUES (?,?,?)').run(String(r.id), String(r.digest), String(r.reply));
    db.prepare("UPDATE mobile_sync_head SET seq=? WHERE id='quick_notes'").run(p.seq);
    return p.result;
  });
  return { sync: async (o, c) => execute.immediate(o, c), close: async () => { db.close(); } };
}
export function createPgMobileSyncStore(url: string): MobileSyncStore {
  const db = postgres(url, { max: 1, connect_timeout: 5, idle_timeout: 20 });
  return {
    sync: async (operations, cursor) => db.begin(async tx => {
      // DDL is deployed by migration; no fallback authority or best-effort dual write.
      await tx.unsafe("INSERT INTO mobile_sync_head(id,seq) VALUES ('quick_notes',0) ON CONFLICT(id) DO NOTHING");
      const head = await tx.unsafe("SELECT seq FROM mobile_sync_head WHERE id='quick_notes' FOR UPDATE");
      const seq = Number(head[0]!.seq);
      if (cursor > seq) throw new MobileAuthError(409, 'cursor_invalid', '同步游标超过服务端版本');
      const receipts: Row[] = [];
      for (const o of operations) receipts.push(...await tx.unsafe('SELECT * FROM mobile_sync_receipts WHERE id=$1', [o.opId]));
      const p = plan({ seq, receipts, records: (await tx.unsafe('SELECT * FROM mobile_sync_records')).map(decodeRecord), notes: await tx.unsafe('SELECT * FROM quick_notes') }, operations, cursor);
      for (const r of p.changed) await tx.unsafe('INSERT INTO mobile_sync_records(id,revision,seq,payload) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,seq=excluded.seq,payload=excluded.payload', [r.recordId, r.revision, r.seq, r.payload === null ? null : JSON.stringify(r.payload)]);
      for (const r of p.writes) {
        if (!r.payload) await tx.unsafe('DELETE FROM quick_notes WHERE id=$1', [r.recordId]);
        else { const n = r.payload; await tx.unsafe('INSERT INTO quick_notes(id,title,content,tags,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,tags=excluded.tags,created_at=excluded.created_at,updated_at=excluded.updated_at', [r.recordId, n.title, n.content, JSON.stringify(n.tags), new Date(n.createdAt).toISOString(), new Date(n.updatedAt).toISOString()]); }
      }
      for (const r of p.receipts) await tx.unsafe('INSERT INTO mobile_sync_receipts(id,digest,reply) VALUES ($1,$2,$3)', [String(r.id), String(r.digest), String(r.reply)]);
      await tx.unsafe("UPDATE mobile_sync_head SET seq=$1 WHERE id='quick_notes'", [p.seq]);
      return p.result;
    }) as Promise<SyncResult>,
    close: async () => { await db.end(); },
  };
}
let singleton: MobileSyncStore | undefined;
export function mobileSyncStore(): MobileSyncStore {
  const url = readDatabaseUrl();
  return singleton ??= isPostgresUrl(url) ? createPgMobileSyncStore(url) : createSqliteMobileSyncStore(url.startsWith('file:') ? url.slice(5) : url);
}
