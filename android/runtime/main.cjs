const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = __dirname;
const user = process.argv[2];
const native = process.argv[3];
let phase = 'config';
let failed = false;
function setPhase(value) {
  phase = value;
  fs.writeFileSync(path.join(user, 'runtime-phase'), value);
}
function reportError(error) {
  failed = true;
  console.error('[Android startup]', error);
  // Only export a stage and machine codes. Error messages may contain private data.
  const safeCode = (value) => typeof value === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(value) ? value : 'UNKNOWN';
  try {
    fs.rmSync(path.join(user, 'runtime-ready'), { force: true });
    fs.writeFileSync(path.join(user, 'runtime-error'), JSON.stringify({ phase, name: safeCode(error?.name), code: safeCode(error?.code) }));
  } catch (writeError) { console.error('[Android startup] Cannot save diagnostic:', writeError.code); }
}
process.on('uncaughtException', reportError);
process.on('unhandledRejection', reportError);
setPhase('config');
const config = JSON.parse(fs.readFileSync(path.join(user, 'config.json'), 'utf8'));
process.chdir(root);
Object.assign(process.env, {
  DESKTOP_MODE: '1', ANDROID_MODE: '1', HOST: '127.0.0.1', PORT: '43218',
  PUBLIC_SITE_URL: 'http://127.0.0.1:43218',
  DATABASE_URL: `file:${path.join(user, 'blog-local.db')}`,
  APPDATA: path.dirname(user), HOME: path.dirname(user), TMPDIR: path.join(user, 'tmp'),
  ASTRO_TELEMETRY_DISABLED: '1', BYQX_SQLITE_NATIVE: path.join(native, 'libbetter_sqlite3.so'),
  ASTRO_NODE_AUTOSTART: 'disabled',
});
fs.mkdirSync(process.env.TMPDIR, { recursive: true });
if (!config.AUTH_SECRET) { config.AUTH_SECRET = crypto.randomBytes(32).toString('base64url'); fs.writeFileSync(path.join(user, 'config.json'), JSON.stringify(config)); }
for (const key of ['ADMIN_PASSWORD', 'TOP_ADMIN_PASSWORD', 'AUTH_SECRET', 'SYNC_DATABASE_URL', 'SYNC_DATABASE_URL_FALLBACK', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL', 'R2_S3_ENDPOINT', 'BLOB_READ_WRITE_TOKEN', 'PUBLIC_TWIKOO_ENV_ID', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ADMIN_GITHUB_LOGIN']) {
  if (typeof config[key] === 'string') process.env[key] = config[key];
}
process.env.TOP_ADMIN_PASSWORD ||= process.env.ADMIN_PASSWORD;
setPhase('sqlite');
const Database = require('better-sqlite3');
if (!fs.existsSync(path.join(user, 'blog-local.db'))) fs.copyFileSync(path.join(root, 'template.db'), path.join(user, 'blog-local.db'));
const db = new Database(path.join(user, 'blog-local.db'));
if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('本地数据库完整性检查失败，请恢复备份');
db.close();
setPhase('astro');
import(pathToFileURL(path.join(root, 'dist/server/entry.mjs')).href).then((entry) => {
  const service = entry.startServer();
  // Astro's server is a lifecycle wrapper; its .server is the Node HTTP server.
  const httpServer = service.server.server;
  const markReady = () => {
    if (failed) return;
    setPhase('ready');
    fs.writeFileSync(path.join(user, 'runtime-ready'), '43218');
  };
  if (httpServer.listening) markReady();
  else httpServer.once('listening', markReady);
  service.done.catch(reportError);
}).catch(reportError);
