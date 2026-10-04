/** Vercel build validation with transient, uniquely named rows and guaranteed cleanup. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { db, dbWrite } from '../db/index';
import { aiConversations } from '../db/schema.sqlite';
import { createPgCadenceStore } from '../src/lib/cadence-store';

const fallbackProbe = process.argv.includes('--fallback-probe');
if (process.env.VERCEL !== '1') {
  console.log('[cloud-db-check] local build: skip live production checks');
} else {
  const urls = [process.env.DATABASE_URL, process.env.DATABASE_URL_FALLBACK].filter((url): url is string => !!url && /^postgres(ql)?:\/\//.test(url));
  assert(urls.length > 0, 'At least one PostgreSQL endpoint must be configured');
  const clients = (fallbackProbe ? urls.slice(-1) : [...new Set(urls)]).map(url => postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} }));
  const id = `__deploy_dual_${randomUUID()}`;
  const stamp = new Date();
  const previousError = console.error;
  if (fallbackProbe) console.error = () => {}; // Expected failed-primary diagnostics contain no useful deployment output.
  try {
    // This is the actual application's ORM mirror, not separate direct inserts.
    const created = await db.insert(aiConversations).values({ id, title: 'deployment probe', summarized: true, startedAt: stamp, updatedAt: stamp }).returning();
    assert.equal(created[0]?.id, id);
    for (const client of clients) {
      const rows = await client`SELECT summarized, updated_at FROM ai_conversations WHERE id = ${id}`;
      assert.equal(rows[0]?.summarized, true);
      assert.equal(rows[0]?.updated_at.getTime(), stamp.getTime());
    }
    const updated = await db.update(aiConversations).set({ summarized: false }).where(eq(aiConversations.id, id)).returning();
    assert.equal(updated[0]?.id, id);
    const selected = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
    assert.equal(selected[0]?.summarized, false);
    // dbWrite is also used by DDL/complex write paths; verify both branches.
    await dbWrite(async endpoint => { await endpoint.update(aiConversations).set({ title: 'updated probe' }).where(eq(aiConversations.id, id)); });
    for (const client of clients) {
      const rows = await client`SELECT title, summarized FROM ai_conversations WHERE id = ${id}`;
      assert.equal(rows[0]?.title, 'updated probe');
      assert.equal(rows[0]?.summarized, false);
    }
    await db.delete(aiConversations).where(eq(aiConversations.id, id)).returning();
    for (const client of clients) assert.equal((await client`SELECT id FROM ai_conversations WHERE id = ${id}`).length, 0);
    const cadence = createPgCadenceStore(process.env.DATABASE_URL!, process.env.DATABASE_URL_FALLBACK || '');
    const cadenceId = `settings:${id}`;
    try {
      const first = await cadence.sync([{ table: 'settings', recordId: id, payload: { key: id, value: 'probe' }, baseRevision: null }]);
      assert.equal(first.conflicts.length, 0);
      for (const client of clients) {
        const rows = await client`SELECT revision FROM cadence_records WHERE id = ${cadenceId}`;
        assert.equal(rows[0]?.revision, first.records[0]?.revision);
      }
      const removed = await cadence.sync([{ table: 'settings', recordId: id, payload: null, baseRevision: first.records[0]!.revision }]);
      assert.equal(removed.conflicts.length, 0);
      for (const client of clients) {
        const rows = await client`SELECT revision, payload FROM cadence_records WHERE id = ${cadenceId}`;
        assert.equal(rows[0]?.revision, removed.records[0]?.revision);
        assert.equal(rows[0]?.payload, null);
      }
      console.log(`[cloud-db-check] Cadence CAS revision/tombstone ${fallbackProbe ? 'fallback' : 'mirror'} passed`);
    } finally {
      await Promise.allSettled(clients.map(client => client`DELETE FROM cadence_records WHERE id = ${cadenceId}`));
      await cadence.close();
    }
    console.log(`[cloud-db-check] ${fallbackProbe ? 'failed-primary fallback read/write' : 'ORM mirrored insert/update/delete/returning and timestamps'} passed on ${clients.length} endpoint(s)`);
  } finally {
    console.error = previousError;
    await Promise.allSettled(clients.map(async client => {
      try { await client`DELETE FROM ai_conversations WHERE id = ${id}`; }
      finally { await client.end({ timeout: 5 }); }
    }));
  }
  if (!fallbackProbe && process.env.DATABASE_URL_FALLBACK) {
    const child = spawn(process.execPath, ['--import', 'tsx', import.meta.filename, '--fallback-probe'], {
      env: { ...process.env, DATABASE_URL: 'postgres://probe:probe@127.0.0.1:1/probe' }, stdio: 'inherit',
    });
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 0, 'Fallback ORM probe failed');
  }
  // Database singletons have idle connections; the build probe is an explicit CLI command.
  process.exit(0);
}
