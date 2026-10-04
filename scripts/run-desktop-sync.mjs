/** Run the installed desktop client's authenticated, idempotent sync API. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { readSyncState } = createRequire(import.meta.url)('../desktop/sync-request.cjs');
const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'byqx-blog-desktop/config.json'), 'utf8'));
const origin = `http://127.0.0.1:${config.PORT || 43217}`;
const login = await fetch(origin + '/api/login', {
  method: 'POST', headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ password: config.ADMIN_PASSWORD }), signal: AbortSignal.timeout(10000),
});
if (!login.ok) throw new Error(`Local login: HTTP ${login.status}`);
const cookie = login.headers.get('set-cookie').split(';')[0];
const start = await fetch(origin + '/api/desktop/sync', {
  method: 'POST', headers: { cookie, origin }, signal: AbortSignal.timeout(10000),
});
if (!start.ok) throw new Error(`Start sync: HTTP ${start.status}`);
let state, lastTable;
const deadline = Date.now() + 15 * 60 * 1000;
while (Date.now() < deadline) {
  state = await readSyncState(origin + '/api/desktop/sync', cookie);
  if (state.progress?.table !== lastTable) {
    lastTable = state.progress?.table;
    if (lastTable) console.log(`Syncing ${lastTable}`);
  }
  if (!state.running) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (state?.running) throw new Error('Sync deadline exceeded');
fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/desktop-sync-run.json', JSON.stringify(state, null, 2));
if (state.lastError || !state.lastReport?.ok) throw new Error(state.lastError || state.lastReport?.warnings.join('; ') || 'No successful report');
console.log(JSON.stringify({ ok: true, durationMs: state.lastReport.finishedAt - state.lastReport.startedAt,
  tables: state.lastReport.perTable.length,
  pushed: state.lastReport.perTable.reduce((sum, t) => sum + t.pushed, 0),
  pulled: state.lastReport.perTable.reduce((sum, t) => sum + t.pulled, 0), warnings: state.lastReport.warnings }));
