/** Verify the installed client's real upload/update/delete path using one transient private record. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import postgres from 'postgres';
const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA!, 'byqx-blog-desktop/config.json'), 'utf8'));
const local = new Database(config.LOCAL_DB_PATH || path.join(process.env.APPDATA!, 'byqx-blog-desktop/blog-local.db'));
const clients = [config.SYNC_DATABASE_URL, config.SYNC_DATABASE_URL_FALLBACK].filter(Boolean).map(url => postgres(url, { max: 1, connect_timeout: 8, onnotice: () => {} }));
const id = `__desktop_sync_probe_${randomUUID()}`;
const stamp = Date.now();
function sync() {
  const result = spawnSync(process.execPath, ['scripts/run-desktop-sync.mjs'], { encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(result.error?.message || 'Installed client sync failed; see outputs/desktop-sync-run.log');
  return JSON.parse(fs.readFileSync('outputs/desktop-sync-run.json', 'utf8')).lastReport;
}
const results = [];
try {
  sync(); // Drain any existing startup sync before creating the probe.
  local.prepare('INSERT INTO ai_conversations (id, title, started_at, summarized, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, 'temporary sync probe', stamp, 1, stamp);
  const inserted = sync();
  for (const client of clients) {
    const rows = await client`SELECT summarized, updated_at FROM ai_conversations WHERE id = ${id}`;
    if (rows[0]?.summarized !== true || rows[0]?.updated_at.getTime() !== stamp) throw new Error('Cloud insert timestamp/boolean verification failed');
  }
  results.push({ operation: 'insert', endpoints: clients.length, pushed: inserted.perTable.find((t: { table: string }) => t.table === 'ai_conversations').pushed });
  local.prepare('UPDATE ai_conversations SET title = ?, summarized = 0, updated_at = ? WHERE id = ?').run('updated sync probe', stamp + 1, id);
  sync();
  for (const client of clients) {
    const rows = await client`SELECT title, summarized, updated_at FROM ai_conversations WHERE id = ${id}`;
    if (rows[0]?.title !== 'updated sync probe' || rows[0]?.summarized !== false || rows[0]?.updated_at.getTime() !== stamp + 1) throw new Error('Cloud update verification failed');
  }
  results.push({ operation: 'update', endpoints: clients.length });
  local.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id);
  const deleted = sync();
  for (const client of clients) if ((await client`SELECT id FROM ai_conversations WHERE id = ${id}`).length) throw new Error('Cloud deletion verification failed');
  results.push({ operation: 'delete', endpoints: clients.length, deleted: deleted.perTable.find((t: { table: string }) => t.table === 'ai_conversations').deletedRemote });
  fs.writeFileSync('outputs/desktop-sync-upload-probe.json', JSON.stringify(results, null, 2));
  console.log('DESKTOP_DUAL_UPLOAD_UPDATE_DELETE_OK ' + JSON.stringify(results));
} finally {
  local.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id);
  await Promise.allSettled(clients.map(async client => {
    try { await client`DELETE FROM ai_conversations WHERE id = ${id}`; }
    finally { await client.end({ timeout: 5 }); }
  }));
  local.close();
}
