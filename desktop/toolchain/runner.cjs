'use strict';
// This is a separate Electron process, with its own profile and no blog preload.
const { app, BrowserWindow, shell, session, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { atomicJson, cleanEnvironment, webUrl } = require('./core.cjs');
const configFile = process.argv.at(-1);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
app.setName(`toolchain-${config.id}`);
app.setAppUserModelId(`byqx.toolchain.${config.id}`);
app.setPath('userData', config.profile);
app.commandLine.appendSwitch('disable-gpu');
let window = null, helper = null, control = null, closing = false, status = 'checking', error = '';
function publish() { atomicJson(config.stateFile, { instanceId: config.instanceId, status, error, pid: process.pid, updatedAt: new Date().toISOString(), controlPort: control?.address()?.port || 0, token: config.token }); }
function fail(reason) { error = String(reason?.message || reason).slice(0, 500); status = 'failed'; publish(); void shutdown(true); }
async function shutdown(failed = false) {
  if (closing) return;
  closing = true;
  // The helper's handle owns the Windows job; process termination closes it and
  // terminates exactly this service and its descendants, regardless of root exit.
  if (helper && helper.exitCode === null) {
    await new Promise(resolve => { const timer = setTimeout(resolve, 3000); helper.once('exit', () => { clearTimeout(timer); resolve(); }); helper.kill(); });
  }
  if (!failed) { status = 'stopped'; error = ''; publish(); }
  if (window && !window.isDestroyed()) window.destroy();
  control?.close();
  setTimeout(() => app.exit(failed ? 1 : 0), 150).unref();
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.on('before-quit', event => { if (!closing) { event.preventDefault(); void shutdown(); } });
app.on('window-all-closed', () => { if (status === 'running') void shutdown(); });
function freePort(port, host) { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(Error('配置的端口已占用，请修改项目启动端口与工具地址；不会接管其他服务'))); server.listen(port, host, () => server.close(resolve)); }); }
async function start() {
  await app.whenReady();
  const target = new URL(webUrl(config.url, true)), port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  control = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${config.token}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) { res.writeHead(403); res.end('{}'); return; }
    if (req.method === 'GET' && req.url === '/status') { res.end(JSON.stringify({ instanceId: config.instanceId, status, error })); return; }
    if (req.method === 'POST' && req.url === '/focus') { if (window && !window.isDestroyed()) { window.restore(); window.show(); window.focus(); } res.end('{}'); return; }
    if (req.method === 'POST' && req.url === '/reload') { if (window && !window.isDestroyed()) window.webContents.reload(); res.end('{}'); return; }
    if (req.method === 'POST' && req.url === '/stop') { res.end('{}'); void shutdown(); return; }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
  publish();
  await freePort(port, target.hostname === '[::1]' ? '::1' : target.hostname);
  status = 'starting'; publish();
  const readyFile = path.join(config.runDir, 'ready');
  if (fs.existsSync(readyFile)) fs.unlinkSync(readyFile);
  const jobConfig = path.join(config.runDir, 'job.json');
  atomicJson(jobConfig, { executable: config.executable, args: config.args, directory: config.directory, log: config.log, port, readyFile, ownerPid: process.pid });
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  helper = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'job.ps1'), '-Configuration', jobConfig], { cwd: config.directory, windowsHide: true, env: cleanEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
  helper.stderr.on('data', chunk => fs.appendFileSync(config.log, chunk));
  helper.stdout.on('data', chunk => fs.appendFileSync(config.log, chunk));
  helper.on('error', fail);
  helper.on('exit', code => { if (!closing) fail(Error(`项目服务已退出（${code}），请查看日志后重启`)); });
  const deadline = Date.now() + 90000;
  while (!closing && Date.now() < deadline) {
    if (fs.existsSync(readyFile)) {
      try { const response = await fetch(target, { signal: AbortSignal.timeout(1800), redirect: 'manual' }); if (response.status < 500) break; } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  if (closing) return;
  if (!fs.existsSync(readyFile) || Date.now() >= deadline) throw Error('90 秒内未就绪，请核对启动命令、端口和本机监听地址；可在工具卡片查看日志');
  const isolated = session.fromPartition(`persist:toolchain-${config.id}`);
  const permitted = new Set(['clipboard-sanitized-write', 'fullscreen', 'persistent-storage']);
  const sameOrigin = value => { try { return new URL(value).origin === target.origin; } catch { return false; } };
  isolated.setPermissionCheckHandler((wc, permission, origin) => wc === window?.webContents && sameOrigin(origin) && permitted.has(permission));
  isolated.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (wc !== window?.webContents || !sameOrigin(details.requestingUrl || wc.getURL())) { callback(false); return; }
    if (permitted.has(permission)) { callback(true); return; }
    if (!['media', 'clipboard-read'].includes(permission)) { callback(false); return; }
    try {
      const answer = await dialog.showMessageBox(window, { type: 'question', title: `${config.name} · 使用权限`, message: permission === 'media' ? '允许此工具使用麦克风或摄像头吗？' : '允许此工具读取剪贴板吗？', buttons: ['拒绝', '允许'], defaultId: 0, cancelId: 0 });
      if (answer.response === 1) permitted.add(permission);
      callback(answer.response === 1);
    } catch { callback(false); }
  });
  window = new BrowserWindow({ width: 1200, height: 850, minWidth: 360, title: config.name, autoHideMenuBar: true, backgroundColor: '#fbf7ee', webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, devTools: false } });
  window.setMenu(null);
  const external = url => { try { void shell.openExternal(webUrl(url)); } catch {} };
  window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== target.origin) { event.preventDefault(); external(url); } });
  window.webContents.on('will-redirect', (event, url) => { if (new URL(url).origin !== target.origin) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => { if (!closing) fail(Error(`工具窗口异常结束（${details.reason}），已停止其服务`)); });
  window.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && ['n', 't'].includes(input.key.toLowerCase())) event.preventDefault();
    if (input.type === 'keyDown' && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) { event.preventDefault(); window.webContents.reload(); }
  });
  window.on('closed', () => { window = null; void shutdown(); });
  await window.loadURL(target.href);
  status = 'running'; publish();
}
void start().catch(fail);
