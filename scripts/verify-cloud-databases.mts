/** Vercel build validation with transient, uniquely named rows and guaranteed cleanup. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { db, dbWrite } from '../db/index';
import { aiConversations, settings } from '../db/schema.sqlite';
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
    // Exercise the same existing KV-table upsert as /api/ui-style without changing the site's preference.
    for (const defaultStyle of ['material3', 'classic']) {
      const value = JSON.stringify({ defaultStyle });
      await dbWrite(async endpoint => {
        await endpoint.insert(settings).values({ key: id, value, updatedAt: stamp })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: stamp } });
      });
      assert.equal((await db.select().from(settings).where(eq(settings.key, id)))[0]?.value, value);
      for (const client of clients) {
        const rows = await client`SELECT value, updated_at FROM settings WHERE key = ${id}`;
        assert.equal(rows[0]?.value, value);
        assert.equal(rows[0]?.updated_at.getTime(), stamp.getTime());
      }
    }
    console.log(`[cloud-db-check] settings KV upsert/read ${fallbackProbe ? 'fallback' : 'mirror'} passed`);
    const cadence = createPgCadenceStore(process.env.DATABASE_URL!, process.env.DATABASE_URL_FALLBACK || '');
    const cadenceId = `settings:${id}`;
    const minuteId = `scheduleEvents:${id}`;
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
      // Reserved probe date and unique id; exercise integer minutes through the real mirror.
      const minute = { id, dateKey: '9900-01-01', startMin: 547, endMin: 548, title: 'minute precision probe', done: false, createdAt: stamp.getTime(), updatedAt: stamp.getTime() };
      let saved = await cadence.sync([{ table: 'scheduleEvents', recordId: id, payload: minute, baseRevision: null }]);
      assert.equal(saved.conflicts.length, 0);
      for (const [startMin, endMin] of [[547, 548], [1439, 1440]]) {
        if (startMin === 1439) saved = await cadence.sync([{ table: 'scheduleEvents', recordId: id, payload: { ...minute, startMin, endMin }, baseRevision: saved.records[0]!.revision }]);
        assert.equal(saved.conflicts.length, 0);
        for (const client of clients) {
          const rows = await client`SELECT payload FROM cadence_records WHERE id = ${minuteId}`;
          const payload = JSON.parse(rows[0]!.payload);
          assert.equal(payload.startMin, startMin); assert.equal(payload.endMin, endMin);
        }
      }
      await cadence.sync([{ table: 'scheduleEvents', recordId: id, payload: null, baseRevision: saved.records[0]!.revision }]);
      console.log(`[cloud-db-check] 09:07-09:08 / 23:59-24:00 minute precision ${fallbackProbe ? 'fallback' : 'mirror'} passed`);
    } finally {
      await Promise.allSettled(clients.map(client => client`DELETE FROM cadence_records WHERE id = ${cadenceId}`));
      await Promise.allSettled(clients.map(client => client`DELETE FROM cadence_records WHERE id = ${minuteId}`));
      await cadence.close();
    }
    console.log(`[cloud-db-check] ${fallbackProbe ? 'failed-primary fallback read/write' : 'ORM mirrored insert/update/delete/returning and timestamps'} passed on ${clients.length} endpoint(s)`);
  } finally {
    console.error = previousError;
    await Promise.allSettled(clients.map(async client => {
      try {
        await client`DELETE FROM ai_conversations WHERE id = ${id}`;
        await client`DELETE FROM settings WHERE key = ${id}`;
      }
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
