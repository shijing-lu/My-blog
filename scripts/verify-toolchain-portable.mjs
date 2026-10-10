/** Test the real portable executable using exclusively isolated local data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { _electron } from 'playwright-core';

const root = process.cwd();
const portable = path.join(root, 'release/portable');
const executable = path.join(portable, '白衣卿相.exe');
const packagedMain = path.join(portable, 'resources/app/desktop/main.cjs');
const out = path.join(root, 'outputs/toolchain-portable-review', String(Date.now()));
const appData = path.join(out, 'appdata'), profile = path.join(out, 'profile');
const project = path.join(out, '源码 项目');
for (const directory of [out, project, profile, path.join(appData, 'byqx-blog-desktop')]) fs.mkdirSync(directory, { recursive: true });
const report = { executable, isolated: true, cases: [], errors: [] };
const record = message => { report.cases.push(message); console.log(message); };
const digest = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
for (const file of ['main.cjs', 'preload.cjs', 'toolchain/core.cjs', 'toolchain/manager.cjs', 'toolchain/runner.cjs', 'toolchain/job.ps1']) {
  assert.equal(digest(path.join(root, 'desktop', file)), digest(path.join(portable, 'resources/app/desktop', file)), file);
}
record('Portable main, preload and all four toolchain runtime files match the source');
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const port = await freePort(), toolPort = await freePort();
const dbPath = path.join(out, 'test.db');
const original = new Database(path.join(root, 'outputs/toolchain-desktop-review/test.db'), { readonly: true });
try { await original.backup(dbPath); } finally { original.close(); }
fs.writeFileSync(path.join(appData, 'byqx-blog-desktop/config.json'), JSON.stringify({ LOCAL_DB_PATH: dbPath, ADMIN_PASSWORD: 'portable-isolated-review-only', AUTH_SECRET: 'portable-isolated-review-secret', SYNC_DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/isolated', PORT: String(port) }));
// The executable's independent-runner entry loads this test-only bootstrap before
// any blog code. Set isolated paths first, then run its unchanged packaged main.
const bootstrap = path.join(out, 'bootstrap.cjs');
fs.writeFileSync(bootstrap, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});app.setPath('userData',${JSON.stringify(profile)});process.argv=[process.argv[0]];const main=${JSON.stringify(packagedMain)};delete require.cache[require.resolve(main)];require(main);`);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'portable-isolated-tool', scripts: { start: 'node server.cjs' } }));
fs.writeFileSync(path.join(project, 'server.cjs'), `const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('owned.json',JSON.stringify({root:process.pid,child:child.pid}));require('http').createServer((q,s)=>s.end('<!doctype html><meta charset="utf-8"><title>便携版工具验收</title><h1>独立工具窗口</h1>')).listen(${toolPort},'127.0.0.1');`);
const env = { ...process.env, BYQX_START_PATH: '/toolchain', BYQX_PI_AUTH_PATH: path.join(out, 'pi.json'), BYQX_CONFIG_PATH: path.join(out, 'ai.json'), DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL_FALLBACK: '' };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => _electron.launch({ executablePath: executable, args: ['--toolchain-runner', bootstrap], env, cwd: out, timeout: 60000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const gone = pid => { try { process.kill(pid, 0); return false; } catch { return true; } };
async function waitGone(pid) { for (let i = 0; i < 80 && !gone(pid); i++) await delay(150); assert.equal(gone(pid), true, `process ${pid} did not stop`); }
let app, entry, stateFile, state;
const invoke = (page, action, input = {}) => page.evaluate(async ({ action, input }) => { const result = await window.desktop.toolchain(action, input); if (!result.ok) throw Error(result.error); return result.data; }, { action, input });
async function waitState(wanted) {
  for (let i = 0; i < 200; i++) {
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
    if (state?.status === wanted) return state;
    if (state?.status === 'failed') throw Error(state.error);
    await delay(300);
  }
  throw Error(`timeout waiting for ${wanted}`);
}
try {
  app = await launch();
  assert.deepEqual(await app.evaluate(({ app }) => ({ packaged: app.isPackaged, appData: app.getPath('appData') })), { packaged: true, appData });
  const page = await app.firstWindow();
  await page.waitForURL(`http://127.0.0.1:${port}/login?**`, { timeout: 60000 });
  assert.equal(await page.evaluate(async () => (await fetch('/api/toolchain/access')).status), 403);
  await page.evaluate(async () => { const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'portable-isolated-review-only' }) }); if (!response.ok) throw Error('isolated login failed'); });
  await page.goto(`http://127.0.0.1:${port}/toolchain`);
  await page.getByRole('button', { name: '添加工具', exact: true }).waitFor();
  assert.equal(await page.locator('a[href="/quick-notes"] + a[href="/toolchain"]').count(), 1);
  record('Real portable blog starts outside the source directory; visitor denied and owner portal works');
  entry = await invoke(page, 'save', { kind: 'source', name: '便携版隔离验收', path: project, command: 'npm run start', url: `http://127.0.0.1:${toolPort}`, tags: '验收' });
  stateFile = path.join(appData, 'byqx-blog-desktop/toolchain/runs', entry.id, 'state.json');
  await invoke(page, 'launch', { id: entry.id });
  await waitState('running');
  const first = { ...state }, owned = JSON.parse(fs.readFileSync(path.join(project, 'owned.json'), 'utf8'));
  assert.equal((await fetch(`http://127.0.0.1:${toolPort}`)).status, 200);
  const runnerPath = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.UTF8Encoding]::new();(Get-Process -Id ${first.pid}).Path`], { windowsHide: true, encoding: 'utf8' }).trim();
  assert.equal(runnerPath.toLowerCase(), executable.toLowerCase());
  await invoke(page, 'launch', { id: entry.id }); await waitState('running'); assert.equal(state.instanceId, first.instanceId);
  await page.screenshot({ path: path.join(out, 'portable-toolchain.png'), fullPage: true });
  record('Packaged manager launches this portable executable as an independent tool; repeat click reuses it');
  const hostPid = app.process().pid;
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  await waitGone(hostPid); app = undefined;
  assert.equal((await fetch(`http://127.0.0.1:${toolPort}`)).status, 200); assert.equal(gone(first.pid), false);
  record('Exiting the portable blog leaves the independent tool and service running');
  app = await launch();
  const restored = await app.firstWindow(); await restored.waitForURL(`http://127.0.0.1:${port}/toolchain`, { timeout: 60000 });
  await restored.getByRole('button', { name: '添加工具', exact: true }).waitFor();
  const entries = await invoke(restored, 'list');
  assert.equal(entries.find(value => value.id === entry.id)?.status, 'running');
  record('Restarting the portable blog restores the card and reconnects to the running tool');
  const closeResult = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${first.pid}).CloseMainWindow()`], { encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(closeResult, 'True');
  await waitState('stopped'); await waitGone(first.pid); await waitGone(owned.root); await waitGone(owned.child);
  await assert.rejects(fetch(`http://127.0.0.1:${toolPort}`, { signal: AbortSignal.timeout(1000) }));
  record('Closing the tool window stops its service and descendants without touching the blog');
  console.log('TOOLCHAIN_PORTABLE_OK', report.cases.length);
} catch (error) { report.errors.push(error.stack); throw error; }
finally {
  if (state?.controlPort && state?.token) await fetch(`http://127.0.0.1:${state.controlPort}/stop`, { method: 'POST', headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000) }).catch(() => {});
  await app?.close().catch(() => {});
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'outputs/toolchain-portable-review/latest.json'), JSON.stringify({ out, ...report }, null, 2));
}
