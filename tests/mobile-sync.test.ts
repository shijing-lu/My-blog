import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteMobileSyncStore, validateOperation, type MobileSyncStore, type NotePayload, type SyncOperation } from '../src/lib/mobile-sync-store';
let folder: string, db: Database.Database, store: MobileSyncStore;
const payload = (content = '中文离线想法'): NotePayload => ({ title: '随心录', content, tags: ['灵感'], createdAt: 1000, updatedAt: 2000 });
const operation = (recordId: string = randomUUID(), baseRevision: string | null = null, value: NotePayload | null = payload()): SyncOperation => ({ opId: randomUUID(), recordId, baseRevision, payload: value });
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'byqx-sync-')); const path = join(folder, 'fixture.db'); db = new Database(path);
  db.exec('CREATE TABLE quick_notes(id text PRIMARY KEY,title text,content text,tags text,created_at integer,updated_at integer)');
  store = createSqliteMobileSyncStore(path);
});
afterEach(async () => { await store.close(); db.close(); rmSync(folder, { recursive: true, force: true }); });
describe('atomic SQLite mobile sync', () => {
  it('saves business row, revision and receipt atomically', async () => {
    const op = operation(); const result = await store.sync([op], 0);
    expect(result.acknowledgements[0]!.status).toBe('accepted');
    expect(db.prepare('SELECT content FROM quick_notes').get()).toEqual({ content: op.payload!.content });
    expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_sync_receipts').get()).toEqual({ count: 1 });
    expect(result.records).toHaveLength(1);
  });
  it('retries a lost response without creating another revision', async () => {
    const op = operation(); const first = await store.sync([op], 0); const retry = await store.sync([op], 0);
    expect(retry).toEqual(first);
  });
  it('rejects operation id reuse and rolls back every earlier operation in batch', async () => {
    const op = operation(); await store.sync([op], 0);
    await expect(store.sync([operation(), { ...op, payload: payload('变更') }], 0)).rejects.toMatchObject({ status: 409 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM quick_notes').get()).toEqual({ count: 1 });
  });
  it('preserves mobile baseline conflict after direct Web/desktop edit', async () => {
    const op = operation(); const first = await store.sync([op], 0); const base = first.records[0]!;
    db.prepare('UPDATE quick_notes SET content=?,updated_at=? WHERE id=?').run('网站同时修改', 3000, op.recordId);
    const conflict = await store.sync([operation(op.recordId, base.revision, payload('手机同时修改'))], Number(first.cursor));
    expect(conflict.acknowledgements[0]).toMatchObject({ status: 'conflict', record: { payload: { content: '网站同时修改' } } });
    expect(db.prepare('SELECT content FROM quick_notes').get()).toEqual({ content: '网站同时修改' });
  });
  it('manual local resolution uses latest remote revision and can conflict again', async () => {
    const op = operation(); const first = await store.sync([op], 0);
    const remote = await store.sync([operation(op.recordId, first.records[0]!.revision, payload('远端'))], 0);
    const conflict = await store.sync([operation(op.recordId, first.records[0]!.revision, payload('本地'))], 0);
    const resolved = await store.sync([operation(op.recordId, conflict.acknowledgements[0]!.record.revision, payload('本地'))], 0);
    expect(remote.acknowledgements[0]!.status).toBe('accepted'); expect(resolved.acknowledgements[0]!.status).toBe('accepted');
    expect(db.prepare('SELECT content FROM quick_notes').get()).toEqual({ content: '本地' });
  });
  it('propagates mobile and legacy deletes as durable tombstones', async () => {
    const op = operation(); const first = await store.sync([op], 0);
    const removed = await store.sync([operation(op.recordId, first.records[0]!.revision, null)], Number(first.cursor));
    expect(removed.records[0]!.payload).toBeNull();
    expect((await store.sync([operation(op.recordId, first.records[0]!.revision)], 0)).acknowledgements[0]!.status).toBe('conflict');
    const op2 = operation(); await store.sync([op2], 0); db.prepare('DELETE FROM quick_notes WHERE id=?').run(op2.recordId);
    expect((await store.sync([], 0)).records.find(r => r.recordId === op2.recordId)!.payload).toBeNull();
  });
  it('returns an empty cached delta when the cursor is current', async () => {
    const first = await store.sync([operation()], 0);
    expect(await store.sync([], Number(first.cursor))).toMatchObject({ records: [], cursor: first.cursor, hasMore: false });
  });
  it('paginates import and retains all 205 records across restart', async () => {
    const insert = db.prepare('INSERT INTO quick_notes VALUES (?,?,?,?,?,?)');
    for (let i = 0; i < 205; i++) insert.run(randomUUID(), '', String(i), '[]', 1000, 2000);
    let cursor = 0, count = 0, more;
    do { const result = await store.sync([], cursor); cursor = Number(result.cursor); count += result.records.length; more = result.hasMore; } while (more);
    expect(count).toBe(205); await store.close(); store = createSqliteMobileSyncStore(join(folder, 'fixture.db'));
    expect((await store.sync([], cursor)).records).toEqual([]);
  });
  it('rejects cursor ahead of authority and malformed payloads', async () => {
    await expect(store.sync([], 100)).rejects.toMatchObject({ status: 409 });
    expect(() => validateOperation({ ...operation(), payload: { ...payload(), content: '' } })).toThrow();
    expect(() => validateOperation({ ...operation(), opId: 'x' })).toThrow();
    expect(validateOperation(operation())).toMatchObject({ payload: { tags: ['灵感'] } });
  });
  it('two stores sharing one DB serialize competing versions', async () => {
    const second = createSqliteMobileSyncStore(join(folder, 'fixture.db'));
    try {
      const first = await store.sync([operation()], 0); const row = first.records[0]!;
      const results = await Promise.all([store.sync([operation(row.recordId, row.revision, payload('A'))], 0), second.sync([operation(row.recordId, row.revision, payload('B'))], 0)]);
      expect(results.map(r => r.acknowledgements[0]!.status).sort()).toEqual(['accepted', 'conflict']);
    } finally { await second.close(); }
  });
});
