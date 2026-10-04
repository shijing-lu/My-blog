/** Headless service benchmark; measures event-loop blocking, not Windows GUI acceptance. */
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { startServerProcess } = require('../desktop/server-process.cjs');
const { ensureLocalDb } = require('../desktop/local-db.cjs');
const variant = process.argv[2] || 'fixed';
const appRoot = path.join(root, 'release', 'portable', 'resources', 'app');
const run = mkdtempSync(path.join(tmpdir(), `byqx-service-${variant}-`));
const configDir = path.join(process.env.APPDATA, 'byqx-blog-desktop');
const config = JSON.parse(readFileSync(path.join(configDir, 'config.json'), 'utf8'));
const source = config.LOCAL_DB_PATH || path.join(configDir, 'blog-local.db');
const localDb = path.join(run, 'blog-local.db');
copyFileSync(source, localDb);
try { copyFileSync(source + '-wal', localDb + '-wal'); } catch {}
const env = { ...process.env, DESKTOP_MODE: '1', DATABASE_URL: `file:${localDb}`, DATABASE_URL_FALLBACK: '',
  HOST: '127.0.0.1', PORT: '49317', PUBLIC_SITE_URL: 'http://127.0.0.1:49317', AUTH_SECRET: 'isolated-benchmark',
  ADMIN_PASSWORD: 'isolated-benchmark', SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '' };
const entry = path.join(appRoot, 'dist', 'server', 'entry.mjs');
const template = path.join(appRoot, 'desktop', 'assets', 'template.db');
const gaps = [];
let last = performance.now();
const start = last;
const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 10);
let server;
try {
  if (variant === 'baseline') {
    Object.assign(process.env, env);
    process.chdir(appRoot);
    ensureLocalDb(localDb, template);
    await import(pathToFileURL(entry).href);
  } else {
    const bootstrap = path.join(run, 'bootstrap.cjs');
    writeFileSync(bootstrap, `process.parentPort = { postMessage: message => process.send(message) }; require(${JSON.stringify(path.join(root, 'desktop', 'server.cjs'))});`);
    server = startServerProcess({
      fork: (_file, args, options) => fork(bootstrap, args, { ...options, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }),
      modulePath: bootstrap, args: [entry, localDb, template], cwd: appRoot, env,
    });
    await server.started;
  }
  let response;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { response = await fetch(env.PUBLIC_SITE_URL); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!response?.ok) throw new Error('Homepage failed to become ready');
  await response.text();
  await new Promise(resolve => setTimeout(resolve, 50));
  const result = { variant, status: response.status, elapsedMs: Math.round(performance.now() - start),
    maxMainGapMs: Math.round(Math.max(...gaps)), samples: gaps.length, boundary: 'service event loop; Windows GUI not measured' };
  mkdirSync(path.join(root, 'outputs'), { recursive: true });
  writeFileSync(path.join(root, 'outputs', `desktop-startup-${variant}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { clearInterval(timer); server?.stop(); }
process.exit(0);
