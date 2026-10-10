/** Isolated stage-2/3 device fixture. Never loads private credentials or the user's database. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const root = path.resolve(import.meta.dirname, '..');
const stage = ['3','4'].includes(process.env.NATIVE_FIXTURE_STAGE) ? Number(process.env.NATIVE_FIXTURE_STAGE) : 2;
const ports = { client: 4302+stage*10, control: 4303+stage*10, upstream: 4304+stage*10 };
const folder = path.join(root, `outputs/android-native/stage-${String(stage).padStart(2, '0')}`);
fs.mkdirSync(folder, { recursive: true });
const databasePath = path.join(folder, 'auth-fixture.db');
// A minimal Astro root imports the real handlers and middleware, avoiding large UI/watch caches.
const site = path.join(folder, 'astro-fixture');
function route(relative, source, exports) {
  const target = path.join(site, 'src', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const reference = path.relative(path.dirname(target), path.join(root, source)).replaceAll('\\', '/');
  fs.writeFileSync(target, `export { ${exports} } from ${JSON.stringify(reference.startsWith('.') ? reference : './' + reference)};\n`);
}
route('pages/api/mobile/v1/auth/[action].ts', 'src/pages/api/mobile/v1/auth/[action].ts', 'GET, POST, prerender');
route('pages/api/admin-auth/login.ts', 'src/pages/api/admin-auth/login.ts', 'POST, prerender');
route('pages/api/login.ts', 'src/pages/api/login.ts', 'POST, prerender');
route('middleware.ts', 'src/middleware.ts', 'onRequest');
if (stage >= 3) {
  fs.mkdirSync(path.join(site, 'public'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/native-sync-fixture.html'), path.join(site, 'public/stage3-lab.html'));
  route('pages/api/mobile/v1/sync.ts', 'src/pages/api/mobile/v1/sync.ts', 'POST, prerender');
  route('pages/api/quick-notes.ts', 'src/pages/api/quick-notes.ts', 'GET, POST, prerender');
  route('pages/api/quick-notes/[id].ts', 'src/pages/api/quick-notes/[id].ts', 'GET, PUT, DELETE, prerender');
  const fixtureDb = new Database(databasePath);
  fixtureDb.exec("CREATE TABLE IF NOT EXISTS quick_notes (id text PRIMARY KEY NOT NULL,title text NOT NULL DEFAULT '',content text NOT NULL DEFAULT '',tags text NOT NULL DEFAULT '[]',created_at integer NOT NULL,updated_at integer NOT NULL)");
  fixtureDb.close();
}
if (stage === 4) {
  route('pages/api/mobile/v1/reading/[action].ts','src/pages/api/mobile/v1/reading/[action].ts','GET, POST, prerender');
  const fixtureDb=new Database(databasePath);
  fixtureDb.exec(`CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,title TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,content TEXT NOT NULL DEFAULT '',type TEXT NOT NULL DEFAULT 'tech',summary TEXT NOT NULL DEFAULT '',cover TEXT,tags TEXT NOT NULL DEFAULT '[]',published INTEGER NOT NULL DEFAULT 1,encrypted INTEGER NOT NULL DEFAULT 0,encrypt_hint TEXT NOT NULL DEFAULT '',encrypt_meta TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS article_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,parent_id TEXT,color TEXT NOT NULL DEFAULT '',sort INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS article_post_categories(article_id TEXT PRIMARY KEY,category_id TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS article_views(id TEXT PRIMARY KEY,article_id TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS likes(id TEXT PRIMARY KEY,target_type TEXT NOT NULL,target_id TEXT NOT NULL,user_type TEXT NOT NULL DEFAULT 'anonymous',user_ident TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,UNIQUE(target_type,target_id,user_type,user_ident));`);
  const source=fs.readFileSync(path.join(root,'scripts/native-reading-fixture.md'),'utf8');
  const salt=Buffer.alloc(16,4); const hash=JSON.stringify({v:1,algo:'PBKDF2-SHA256',iterations:250000,salt:salt.toString('base64'),hash:pbkdf2Sync('reading-fixture-only',salt,250000,32,'sha256').toString('base64')});
  const insert=fixtureDb.prepare('INSERT OR IGNORE INTO articles(id,title,slug,content,type,summary,tags,encrypted,encrypt_hint,encrypt_meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('native-reading-open','原生阅读验收','native-reading-open',source,'tech','全部正文组件与离线阅读验收','["原生","验收"]',0,'','',Date.UTC(2026,9,7),Date.UTC(2026,9,7));
  insert.run('native-reading-locked','受保护文章验收','native-reading-locked','# 受保护正文\n\n仅正确密码解锁后可读。','note','密码保护与离线缓存','["私密"]',1,'测试密码：reading-fixture-only',hash,Date.UTC(2026,8,1),Date.UTC(2026,9,7));
  fixtureDb.prepare('INSERT OR IGNORE INTO article_categories VALUES(?,?,?,?,?,?,?)').run('native-category','原生测试',null,'',0,Date.now(),Date.now());
  fixtureDb.prepare('INSERT OR IGNORE INTO article_post_categories VALUES(?,?,?,?)').run('native-reading-open','native-category',Date.now(),Date.now());
  fs.writeFileSync(path.join(site,'public/reading-fixture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#ffd43b"/><circle cx="320" cy="240" r="120" fill="#4dd4c6"/><path d="M100 400L540 80" stroke="#171717" stroke-width="12"/></svg>');
  fixtureDb.close();
}
fs.writeFileSync(path.join(site, 'astro.config.mjs'), `import {defineConfig} from 'astro/config';\nimport node from '@astrojs/node';\nexport default defineConfig({output:'server',adapter:node({mode:'standalone'}),vite:{resolve:{alias:{'@':${JSON.stringify(path.join(root, 'src'))}}},server:{fs:{allow:[${JSON.stringify(root)}]}}}});\n`);
// A fresh random authority per run invalidates previous synthetic sessions without deleting data.
const secretPath = path.join(folder, 'fixture.secret');
if (stage >= 3 && !fs.existsSync(secretPath)) fs.writeFileSync(secretPath, randomBytes(32).toString('hex'));
const secret = stage >= 3 ? fs.readFileSync(secretPath, 'utf8') : randomBytes(32).toString('hex');
const child = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'dev', '--root', site, '--ignore-lock', '--host', '127.0.0.1', '--port', String(ports.upstream)], {
  cwd: root, env: { ...process.env, ASTRO_DEV_BACKGROUND: '1', ASTRO_DISABLE_UPDATE_CHECK: 'true', ASTRO_TELEMETRY_DISABLED: '1', DESKTOP: '1', DESKTOP_MODE: '1', VERCEL: '0', NODE_ENV: 'development',
    DATABASE_URL: `file:${databasePath}`, DATABASE_URL_FALLBACK: '', TOP_ADMIN_PASSWORD: 'native-owner-fixture-only',
    ADMIN_PASSWORD: 'native-legacy-fixture-only', AUTH_SECRET: secret },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
const log = fs.createWriteStream(path.join(folder, 'fixture-server.log'));
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
child.on('error', error => console.error('Fixture subprocess error:', error.message));
child.on('exit', code => console.log('Fixture subprocess exited:', code));
let disconnected = false;
let loseSyncResponse = false;
let readingRequests = 0;
const proxy = http.createServer((request, response) => {
  if (request.url.startsWith('/api/mobile/v1/reading/')) readingRequests++;
  if (stage >= 3 && request.method === 'POST' && ['/fixture-control/disconnect', '/fixture-control/reconnect'].includes(request.url)) {
    disconnected = request.url.endsWith('/disconnect');
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }); response.end(JSON.stringify({ disconnected })); return;
  }
  if (disconnected && (stage === 2 || request.url.startsWith('/api/mobile/'))) { response.destroy(); return; }
  const forward = http.request({ hostname: '127.0.0.1', port: ports.upstream, path: request.url, method: request.method, headers: request.headers }, upstream => {
    if (loseSyncResponse && request.url === '/api/mobile/v1/sync') { loseSyncResponse = false; upstream.resume(); upstream.on('end', () => response.destroy()); return; }
    response.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(response);
  });
  forward.on('error', () => { response.writeHead(503, { 'cache-control': 'private, no-store' }); response.end(); });
  request.pipe(forward);
});
const control = http.createServer((request, response) => {
  response.setHeader('cache-control', 'private, no-store'); response.setHeader('content-type', 'application/json');
  if (request.url === '/disconnect') disconnected = true;
  if (request.url === '/reconnect') disconnected = false;
  if (request.url === '/lose-sync-response') loseSyncResponse = true;
  if (request.url === '/reset-reading-count') readingRequests = 0;
  try {
    const database = new Database(databasePath);
    if (request.url === '/expire') database.prepare("UPDATE mobile_sessions SET access_expires_at = '1970-01-01T00:00:00.000Z' WHERE revoked_at IS NULL").run();
    if (request.url === '/revoke') database.prepare('UPDATE mobile_sessions SET revoked_at = ? WHERE revoked_at IS NULL').run(new Date().toISOString());
    const row = database.prepare('SELECT COUNT(*) AS rotations FROM mobile_sessions WHERE refresh_request_id IS NOT NULL').get();
    database.close(); response.end(JSON.stringify({ ok: true, disconnected, readingRequests, ...row }));
  } catch { response.end(JSON.stringify({ ok: true, disconnected, rotations: 0 })); }
});
await new Promise(resolve => proxy.listen(ports.client, '127.0.0.1', resolve));
await new Promise(resolve => control.listen(ports.control, '127.0.0.1', resolve));
let ready = false;
for (let i = 0; i < 160; i++) {
  try { const result = await fetch(`http://127.0.0.1:${ports.client}/api/mobile/v1/auth/info`); ready = result.ok && (await result.json()).protocolVersion === 1; } catch {}
  if (ready) break;
  if (child.exitCode !== null) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) { child.kill(); proxy.close(); control.close(); throw new Error('Isolated fixture failed to start; inspect fixture-server.log'); }
console.log(`Isolated stage ${stage} fixture ready: http://127.0.0.1:${ports.client} (control:${ports.control}, synthetic credentials only)`);
const close = () => { child.kill(); proxy.close(); control.close(); log.end(); process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
child.on('exit', () => { proxy.close(); control.close(); });
