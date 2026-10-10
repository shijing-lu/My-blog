/** Isolated archive acceptance server. Never writes to the user's database. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'outputs/archive-workspace');
fs.mkdirSync(output, { recursive: true });
const databasePath = path.join(output, 'test.db');
if (!fs.existsSync(databasePath)) {
  const source = new Database(path.join(root, 'outputs/discovery-workspace/test.db'), { readonly: true });
  try { await source.backup(databasePath); } finally { source.close(); }
  const copy = new Database(databasePath);
  try {
    copy.prepare("DELETE FROM settings WHERE key='image_bed'").run();
    // Dedicated sample articles exercise publication ordering, long titles and protected labels.
    const insert = copy.prepare('INSERT OR REPLACE INTO articles (id,title,slug,content,type,summary,cover,tags,encrypted,created_at,updated_at,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (let i = 0; i < 9; i++) {
      const created = Date.parse(`${2026 - Math.floor(i / 3)}-${i % 2 ? '02' : '10'}-${String(8 - i % 3).padStart(2, '0')}T00:00:00+08:00`);
      insert.run(`archive-review-${i}`, i === 2 ? '归档验收示例：多层学习记录与很长的中文文章标题'.repeat(4) : `归档验收示例 ${i + 1} · 文字留下的脚印`, `archive-review-${i}`, '隔离数据库的归档验收示例。'.repeat(100), 'tech', '此条仅用于本地布局与筛选验收，不会写入实际文章。', null, JSON.stringify(['归档验收', i % 2 ? '多年份' : '排版']), i === 1 ? 1 : 0, created, Date.now() - i, 1);
    }
  } finally { copy.close(); }
}
const port = 43228;
const log = fs.openSync(path.join(output, 'server.log'), 'a');
const child = spawn(process.execPath, [path.join(root, 'dist/server/entry.mjs')], {
  cwd: output, windowsHide: true,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: 'file:' + databasePath,
    DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '',
    BYQX_CONFIG_PATH: path.join(output, 'local-config.json'),
    R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '', R2_PUBLIC_BASE_URL: '',
    ADMIN_PASSWORD: 'article-review-local', TOP_ADMIN_PASSWORD: 'article-review-local', AUTH_SECRET: randomBytes(32).toString('hex'),
    DESKTOP_MODE: '1', SITE_URL: `http://127.0.0.1:${port}` },
  stdio: ['ignore', log, log],
});
fs.writeFileSync(path.join(output, 'server.json'), JSON.stringify({ pid: child.pid, port, databasePath }, null, 2));
child.on('exit', code => { fs.closeSync(log); process.exit(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/ui-style`, { signal: AbortSignal.timeout(1500) })).ok) { console.log(`ARCHIVE_REVIEW_READY http://127.0.0.1:${port}/archive`); break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
  if (i === 39) { child.kill(); throw Error('Archive preview failed'); }
}
