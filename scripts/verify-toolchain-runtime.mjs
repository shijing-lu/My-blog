/** Real Windows/Electron runtime, isolated registry/project; never uses blog data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
const root = process.cwd(), out = path.join(root, 'outputs/toolchain-runtime-review'), project = path.join(out, '源码 项目'), registry = path.join(out, 'registry'), wrapper = path.join(out, 'wrapper');
for (const directory of [out, project, registry, wrapper]) fs.mkdirSync(directory, { recursive: true });
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'toolchain-isolated-fixture', scripts: { start: 'node server.cjs' } }));
fs.writeFileSync(path.join(project, 'server.cjs'), `const fs=require('fs'),cp=require('child_process'); const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync('owned-child.json',JSON.stringify({pid:child.pid,root:process.pid})); require('http').createServer((req,res)=>res.end('<!doctype html><meta charset="utf-8"><title>独立工具验收</title><h1>独立工具窗口</h1><p>无博客导航，无标签栏</p>')).listen(${port},'127.0.0.1');`);
fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({ name: 'toolchain-runtime-review', version: '1.0.0', main: 'main.cjs' }));
fs.writeFileSync(path.join(wrapper, 'main.cjs'), `const {app,BrowserWindow,shell,nativeImage}=require('electron');app.setPath('userData',${JSON.stringify(path.join(out, 'host-profile'))});global.tc=require(${JSON.stringify(path.join(root, 'desktop/toolchain/manager.cjs'))}).createToolchain({directory:${JSON.stringify(registry)},app,shell,nativeImage});app.whenReady().then(()=>{global.win=new BrowserWindow({show:false});win.loadURL('data:text/html,isolated host')});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [wrapper], env, timeout: 30000 });
const report = { cases: [], errors: [] }; let host = await launch(), entry;
report.cases.push = function (...items) { const count = Array.prototype.push.apply(this, items); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(items.join('\n')); return count; };
const invoke = (action, input) => host.evaluate(async (_electron, { action, input }) => global.tc.operation(action, input), { action, input });
const waitStatus = async wanted => { for (let i = 0; i < 160; i++) { const entries = await invoke('list'); const value = entries.find(item => item.id === entry.id); if (value?.status === wanted) return value; if (value?.status === 'failed' && wanted !== 'failed') throw Error(`${value.error}\n${await invoke('logs', { id: entry.id })}`); await new Promise(resolve => setTimeout(resolve, 500)); } throw Error(`timeout waiting ${wanted}`); };
const state = () => JSON.parse(fs.readFileSync(path.join(registry, 'runs', entry.id, 'state.json')));
const control = async action => { const s = state(); const response = await fetch(`http://127.0.0.1:${s.controlPort}/${action}`, { method: action === 'status' ? 'GET' : 'POST', headers: { authorization: `Bearer ${s.token}` } }); assert.equal(response.status, 200); return response.json(); };
try {
  entry = await invoke('save', { kind: 'source', name: '隔离验收项目', path: project, command: 'npm run start', url: `http://127.0.0.1:${port}`, tags: '验收' });
  await invoke('launch', { id: entry.id }); await waitStatus('running');
  const first = state(); const owned = JSON.parse(fs.readFileSync(path.join(project, 'owned-child.json')));
  assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200); report.cases.push('npm service + separate sandboxed app window');
  await invoke('launch', { id: entry.id }); assert.equal(state().instanceId, first.instanceId); report.cases.push('repeat click reuses instance');
  await control('reload'); await new Promise(resolve => setTimeout(resolve, 900)); assert.equal((await control('status')).status, 'running'); report.cases.push('window reload keeps service alive');
  const unauthorized = await fetch(`http://127.0.0.1:${first.controlPort}/stop`, { method: 'POST' }); assert.equal(unauthorized.status, 403); report.cases.push('private instance control requires token');
  const hostPid = host.process().pid;
  await host.evaluate(({ app }) => app.quit()).catch(() => {});
  for (let i = 0; i < 40; i++) { try { process.kill(hostPid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.throws(() => process.kill(hostPid, 0));
  assert.equal((await control('status')).status, 'running'); assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200); report.cases.push('host exit leaves tool running');
  host = await launch(); await waitStatus('running'); assert.equal(state().instanceId, first.instanceId); report.cases.push('host restart reattaches to registered instance');
  const closeResult = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${first.pid}).CloseMainWindow()`], { encoding: 'utf8', windowsHide: true }).trim(); assert.equal(closeResult, 'True');
  await waitStatus('stopped');
  for (let i = 0; i < 30; i++) { try { process.kill(owned.pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.throws(() => process.kill(owned.pid, 0)); assert.throws(() => process.kill(owned.root, 0)); report.cases.push('own window close stops job and npm descendants');
  await invoke('restart', { id: entry.id }); await waitStatus('running'); assert.notEqual(state().instanceId, first.instanceId); report.cases.push('restart creates a fresh instance');
  const crashed = state(), crashChild = JSON.parse(fs.readFileSync(path.join(project, 'owned-child.json')));
  process.kill(crashed.pid);
  for (let i = 0; i < 40; i++) { try { process.kill(crashChild.pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.throws(() => process.kill(crashChild.pid, 0)); report.cases.push('unexpected window-process exit also cleans service descendants');
  await invoke('restart', { id: entry.id }); await waitStatus('running');
  await invoke('stop', { id: entry.id }); await waitStatus('stopped');
  entry = await invoke('save', { ...entry, command: 'pnpm run start', tags: '验收' });
  await invoke('launch', { id: entry.id }); await waitStatus('running');
  await invoke('stop', { id: entry.id }); await waitStatus('stopped'); report.cases.push('pnpm launch works with Chinese/spaced project directory');
  const routeWrapper = path.join(out, 'independent-entry'); fs.mkdirSync(routeWrapper, { recursive: true });
  fs.writeFileSync(path.join(routeWrapper, 'package.json'), JSON.stringify({ name: 'toolchain-independent-entry-review', version: '1.0.0', main: 'main.cjs' }));
  for (const name of ['entry-appdata', 'entry-profile']) fs.mkdirSync(path.join(out, name), { recursive: true });
  fs.writeFileSync(path.join(routeWrapper, 'main.cjs'), `const {app}=require('electron');app.setPath('appData',${JSON.stringify(path.join(out, 'entry-appdata'))});app.setPath('userData',${JSON.stringify(path.join(out, 'entry-profile'))});require(${JSON.stringify(path.join(root, 'desktop/main.cjs'))});`);
  const launchFile = path.join(registry, 'runs', entry.id, 'launch.json');
  const runtimePath = fs.readdirSync(path.join(registry, 'runtime')).find(version => ['runner.cjs', 'core.cjs', 'job.ps1'].every(file => fs.readFileSync(path.join(registry, 'runtime', version, file), 'utf8').replace(/^\uFEFF/, '') === fs.readFileSync(path.join(root, 'desktop/toolchain', file), 'utf8')));
  assert.ok(runtimePath);
  const independent = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [routeWrapper, '--toolchain-runner', path.join(registry, 'runtime', runtimePath, 'runner.cjs'), launchFile], env: createRequire(import.meta.url)('../desktop/toolchain/core.cjs').cleanEnvironment(), timeout: 30000 });
  try {
    const toolPage = await independent.firstWindow(); await toolPage.waitForURL(`http://127.0.0.1:${port}/`); await toolPage.getByRole('heading', { name: '独立工具窗口' }).waitFor();
    assert.equal(await toolPage.evaluate(() => typeof window.desktop), 'undefined');
    assert.equal(await toolPage.evaluate(() => typeof window.require), 'undefined');
    await toolPage.keyboard.press('Control+t'); assert.equal(independent.windows().length, 1);
    assert.equal(await toolPage.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-write' })).state), 'granted');
    await toolPage.screenshot({ path: path.join(out, 'independent-tool-content.png') });
    report.cases.push('desktop independent-entry route has no blog preload/tabs; text-copy permission works');
  } finally { await independent.close(); }
  await waitStatus('stopped');
  const occupied = net.createServer(); await new Promise(resolve => occupied.listen(port, '127.0.0.1', resolve));
  try { await invoke('launch', { id: entry.id }); } catch {}
  await waitStatus('failed'); assert.match(state().error, /占用/); await new Promise(resolve => occupied.close(resolve)); report.cases.push('occupied port fails without taking over other process');
  await invoke('remove', { id: entry.id }); assert.equal(fs.existsSync(path.join(project, 'server.cjs')), true); report.cases.push('remove registration preserves original project');
  console.log('TOOLCHAIN_RUNTIME_OK', report.cases.length);
} catch (error) { report.errors.push(error.stack); throw error; }
finally { if (entry) await invoke('stop', { id: entry.id }).catch(() => {}); await host?.close().catch(() => {}); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
