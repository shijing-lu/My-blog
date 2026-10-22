/**
 * 便携版验收：站主登录后修改站主密码。
 *
 * 覆盖：登录 → /admin 首登提示 → /admin/auth 表单（错误当前密码被拒）→ 改密码成功
 *      → 旧口令登录失败 / 新口令登录成功 → 首登提示消失 → 数据库只存摘要不存明文。
 * 全程使用隔离的 appData / 数据库 / 端口，不碰正式数据。
 * 运行：node scripts/verify-owner-password.mjs（需先 pnpm build:portable）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import Database from 'better-sqlite3';
import { _electron } from 'playwright-core';

const root = process.cwd();
// 便携构建会在 portable / portable2 两个槽位间自动切换，取目录最新的那个。
const portable = ['portable', 'portable2']
  .map(name => path.join(root, 'release', name))
  .filter(dir => fs.existsSync(path.join(dir, '白衣卿相.exe')))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!portable) throw new Error('未找到便携版，请先运行 pnpm build:portable');
const executable = path.join(portable, '白衣卿相.exe');
const packagedMain = path.join(portable, 'resources/app/desktop/main.cjs');
const out = path.join(root, 'outputs/owner-password-review', String(Date.now()));
const appData = path.join(out, 'appdata');
const profile = path.join(out, 'profile');
const toolDir = path.join(appData, 'byqx-blog-desktop');
for (const directory of [out, profile, toolDir]) fs.mkdirSync(directory, { recursive: true });

const initial = 'desktop-initial-owner-pass';
const updated = 'my-new-owner-pass-2026';
const report = { executable, cases: [], errors: [] };
const record = message => { report.cases.push(message); console.log(message); };

assert.ok(fs.existsSync(executable), `未找到便携版：${executable}，请先运行 pnpm build:portable`);
const template = path.join(root, 'outputs/toolchain-desktop-review/test.db');
assert.ok(fs.existsSync(template), `缺少隔离数据库模板：${template}`);

const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const port = await freePort();
const dbPath = path.join(out, 'test.db');
const source = new Database(template, { readonly: true });
try { await source.backup(dbPath); } finally { source.close(); }
fs.writeFileSync(path.join(toolDir, 'config.json'), JSON.stringify({
  LOCAL_DB_PATH: dbPath,
  ADMIN_PASSWORD: initial,
  AUTH_SECRET: 'owner-password-isolated-review-secret',
  SYNC_DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/isolated',
  PORT: String(port),
}));
const bootstrap = path.join(out, 'bootstrap.cjs');
fs.writeFileSync(bootstrap, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});process.argv=[process.argv[0]];const main=${JSON.stringify(packagedMain)};delete require.cache[require.resolve(main)];require(main);`);
const env = { ...process.env, BYQX_START_PATH: '/login', BYQX_PI_AUTH_PATH: path.join(out, 'pi.json'), BYQX_CONFIG_PATH: path.join(out, 'ai.json'), DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL_FALLBACK: '' };
delete env.ELECTRON_RUN_AS_NODE;

let app;
const loginStatus = (page, password) => page.evaluate(async pw => {
  const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  return response.status;
}, password);

try {
  app = await _electron.launch({ executablePath: executable, args: ['--toolchain-runner', bootstrap], env, cwd: out, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForURL(url => url.pathname === '/login', { timeout: 60000 });

  assert.equal(await loginStatus(page, initial), 200);
  record('用初始口令登录成功');

  // 首登提示：还没改过密码时必须出现在 /admin 第一屏
  await page.goto(`http://127.0.0.1:${port}/admin`);
  await page.getByText('你还在使用初始站主密码').waitFor({ timeout: 30000 });
  record('/admin 首屏提示「还在使用初始站主密码」');

  const status = await page.evaluate(async () => (await fetch('/api/owner-password')).json());
  assert.deepEqual(status, { custom: false, source: 'env-admin', updatedAt: null });
  record('GET /api/owner-password 报告来源为环境变量 ADMIN_PASSWORD');

  await page.goto(`http://127.0.0.1:${port}/admin/auth`);
  await page.locator('#op-save').waitFor({ timeout: 30000 });
  assert.match(await page.locator('#op-source').innerText(), /ADMIN_PASSWORD/);
  record('/admin/auth 出现「站主密码」表单并显示当前来源');

  // 当前密码错误 → 拒绝且不改动
  await page.locator('#op-current').fill('definitely-wrong-password');
  await page.locator('#op-new').fill(updated);
  await page.locator('#op-confirm').fill(updated);
  await page.locator('#op-save').click();
  await page.locator('#op-msg').filter({ hasText: '当前密码不正确' }).waitFor({ timeout: 20000 });
  assert.equal(await loginStatus(page, updated), 401);
  record('当前密码错误时拒绝修改，新口令未生效');

  // 正确修改
  await page.locator('#op-current').fill(initial);
  await page.locator('#op-new').fill(updated);
  await page.locator('#op-confirm').fill(updated);
  await page.locator('#op-save').click();
  await page.locator('#op-msg').filter({ hasText: '站主密码已更新' }).waitFor({ timeout: 30000 });
  assert.match(await page.locator('#op-source').innerText(), /本站自定义口令/);
  record('填入正确的当前密码后修改成功，来源变为「本站自定义口令」');

  // 密码语义：旧的不行、新的可以
  assert.equal(await loginStatus(page, initial), 401);
  assert.equal(await loginStatus(page, updated), 200);
  record('旧口令登录被拒（401），新口令登录成功（200）');

  // 首登提示消失
  await page.goto(`http://127.0.0.1:${port}/admin`);
  await page.waitForTimeout(500);
  assert.equal(await page.getByText('你还在使用初始站主密码').count(), 0);
  record('/admin 首屏提示在改完密码后消失');

  await page.screenshot({ path: path.join(out, 'owner-password.png'), fullPage: true });

  // 数据库落盘检查：settings 里只有摘要，没有明文
  const database = new Database(dbPath, { readonly: true });
  let stored;
  try {
    const rows = database.prepare("SELECT key, value FROM settings WHERE key = 'owner_password'").all();
    assert.equal(rows.length, 1, 'settings 中没有 owner_password 记录');
    stored = String(rows[0].value);
  } finally { database.close(); }
  assert.equal(stored.includes(updated), false, '数据库里出现了明文口令');
  assert.match(stored, /scrypt/);
  record('数据库只保存 scrypt 摘要，不含明文口令');

  // 重启：此时 config.json 里的 ADMIN_PASSWORD 已经是旧口令，
  // 本机自动登录必须仍然有效（主进程改为直接签发会话）。
  await app.close();
  app = undefined;
  app = await _electron.launch({ executablePath: executable, args: ['--toolchain-runner', bootstrap], env, cwd: out, timeout: 60000 });
  const restarted = await app.firstWindow();
  await restarted.waitForURL(url => url.protocol === 'http:', { timeout: 60000 });
  const base = new URL(restarted.url()).origin;
  await restarted.goto(`${base}/admin`);
  await restarted.waitForLoadState('load');
  assert.equal(new URL(restarted.url()).pathname, '/admin', '重启后没有自动登录（自动登录仍依赖旧口令）');
  record('重启后本机自动登录仍然有效，不再依赖配置里的旧口令');

  console.log('OWNER_PASSWORD_OK', report.cases.length);
} catch (error) {
  report.errors.push(error.stack);
  throw error;
} finally {
  await app?.close().catch(() => {});
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'outputs/owner-password-review/latest.json'), JSON.stringify({ out, ...report }, null, 2));
}
