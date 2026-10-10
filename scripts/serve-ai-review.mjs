/** Clean local preview; no seeded content, cloud credentials or subscription tokens. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'outputs/ai-review');
fs.mkdirSync(out, { recursive: true });
const databasePath = path.join(out, 'preview.db');
if (!fs.existsSync(databasePath)) {
  const original = new Database(path.join(root, 'outputs/completion-workspace/test.db'), { readonly: true });
  try { await original.backup(databasePath); } finally { original.close(); }
  const local = new Database(databasePath);
  try { local.prepare("DELETE FROM settings WHERE key IN ('ai_config','image_bed','netdisk')").run(); } finally { local.close(); }
}
const port = 43232, log = fs.openSync(path.join(out, 'server.log'), 'a');
const child = spawn(process.execPath, [path.join(root, 'dist/server/entry.mjs')], {
  cwd: out, windowsHide: true, stdio: ['ignore', log, log],
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: 'file:' + databasePath,
    DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '',
    BYQX_CONFIG_PATH: path.join(out, 'local-config.json'), BYQX_PI_AUTH_PATH: path.join(out, 'pi-auth.json'),
    R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '', R2_PUBLIC_BASE_URL: '',
    ADMIN_PASSWORD: 'article-review-local', TOP_ADMIN_PASSWORD: 'article-review-local',
    AUTH_SECRET: 'ai-review-local-isolated-secret', DESKTOP_MODE: '1', SITE_URL: `http://127.0.0.1:${port}`,
  },
});
fs.writeFileSync(path.join(out, 'server.json'), JSON.stringify({ pid: child.pid, port, databasePath }, null, 2));
child.on('exit', code => { fs.closeSync(log); process.exit(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/ui-style`, { signal: AbortSignal.timeout(1000) })).ok) { console.log(`AI_REVIEW_READY http://127.0.0.1:${port}/admin/settings/ai`); break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
  if (i === 59) { child.kill(); throw Error('AI preview failed'); }
}
