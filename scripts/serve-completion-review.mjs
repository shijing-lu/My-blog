/** Copied SQLite acceptance environment for the final redesign batch. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'outputs/completion-workspace');
fs.mkdirSync(out, { recursive: true });
const databasePath = path.join(out, 'test.db');
if (!fs.existsSync(databasePath)) {
  const original = new Database(path.join(root, 'outputs/archive-workspace/test.db'), { readonly: true });
  try { await original.backup(databasePath); } finally { original.close(); }
  const db = new Database(databasePath);
  try {
    db.prepare("DELETE FROM settings WHERE key IN ('image_bed','netdisk')").run();
    db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)').run('netdisk', JSON.stringify({ enabled: true, baseUrl: 'http://127.0.0.1:1', adminUsername: 'fixture', adminPassword: 'fixture', managePath: '/' }), Date.now());
    const now = Date.now();
    for (const [id, githubId, login] of [['completion-visitor', 9100001, 'review-visitor'], ['completion-admin', 9100002, 'review-admin']]) db.prepare('INSERT OR REPLACE INTO github_users (id,github_id,login,name,avatar_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, githubId, login, '验收示例 · ' + login, '', now, now);
    db.prepare('INSERT OR REPLACE INTO admin_accounts (id,github_id,login,name,avatar_url,role,permissions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('completion-admin', 9100002, 'review-admin', '验收示例管理员', '', 'admin', '["articles"]', now, now);
    for (let i = 0; i < 2; i++) db.prepare('INSERT OR REPLACE INTO admin_applications (id,github_id,login,name,avatar_url,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('completion-app-' + i, 9100010 + i, 'review-app-' + i, '验收示例申请人 ' + (i + 1), '', '本地权限界面验收示例，无需真实 GitHub 账号。'.repeat(i ? 4 : 1), 'pending', now, now);
    for (let i = 0; i < 26; i++) db.prepare('INSERT OR REPLACE INTO quick_notes (id,title,content,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('completion-note-' + i, i === 0 ? '验收示例 · 很长的记录标题'.repeat(6) : '验收示例 · 灵感 ' + (i + 1), '## 私密记录验收\n\n此记录只存在于隔离数据库。\n\n' + '把今天的想法写下来。'.repeat(i === 0 ? 30 : 2), '["收尾验收","灵感"]', now - i * 86400000, now - i * 86400000);
    db.prepare('INSERT OR REPLACE INTO mindmaps (id,title,article_id,data,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('completion-map-example', '验收示例 · 学习思路', null, JSON.stringify({ data: { text: '验收示例', uid: 'completion-root' }, children: [{ data: { text: '整理', uid: 'completion-node-1' } }, { data: { text: '实践', uid: 'completion-node-2' } }] }), now, now);
  } finally { db.close(); }
}
const port = 43230, log = fs.openSync(path.join(out, 'server.log'), 'a');
const child = spawn(process.execPath, [path.join(root, 'dist/server/entry.mjs')], { cwd: out, windowsHide: true,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: 'file:' + databasePath, DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '', BYQX_CONFIG_PATH: path.join(out, 'local-config.json'),
    R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '', R2_PUBLIC_BASE_URL: '',
    ADMIN_PASSWORD: 'article-review-local', TOP_ADMIN_PASSWORD: 'article-review-local', AUTH_SECRET: 'completion-review-isolated-secret', DESKTOP_MODE: '1', SITE_URL: `http://127.0.0.1:${port}` }, stdio: ['ignore', log, log] });
fs.writeFileSync(path.join(out, 'server.json'), JSON.stringify({ pid: child.pid, port, databasePath }, null, 2));
child.on('exit', code => { fs.closeSync(log); process.exit(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/ui-style`, { signal: AbortSignal.timeout(1000) })).ok) { console.log(`COMPLETION_REVIEW_READY http://127.0.0.1:${port}/quick-notes`); break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); if (i === 39) { child.kill(); throw Error('Completion preview failed'); } }
