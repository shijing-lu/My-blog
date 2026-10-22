'use strict';
/**
 * 脚本启动的宿主进程（独立 Electron 进程，拥有 nopreload、无窗口）。
 *
 * 职责：
 *   1. 用 PowerShell 启动 job.ps1，由它把脚本放进 Windows Job（KILL_ON_JOB_CLOSE）
 *   2. 把状态写到 state.json，并向本机控制端口提供 /status 与 /stop
 *   3. 脚本退出后发布 stopped（退出码 0）或 failed（非 0 或启动失败），随后退出
 *
 * 与 runner.cjs 的差异：脚本没有网址、没有端口就绪、没有浏览器窗口，
 * 因此不做端口探测、不开 BrowserWindow，也不注册任何权限处理器。
 */
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { atomicJson, cleanEnvironment } = require('./core.cjs');

const configFile = process.argv.at(-1);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

app.setName(`toolchain-script-${config.id}`);
app.setAppUserModelId(`byqx.toolchain.${config.id}`);
app.setPath('userData', config.profile);
app.commandLine.appendSwitch('disable-gpu');

let helper = null, control = null, closing = false, status = 'starting', error = '', exitCode = null;
/** 运行区间：startedAt 在脚本真正拉起时写入，finishedAt 在停止或退出时写入（供工具卡片显示时长）。 */
let startedAt = '', finishedAt = '';

function publish() {
  atomicJson(config.stateFile, {
    instanceId: config.instanceId,
    status,
    error,
    exitCode,
    startedAt,
    finishedAt,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    controlPort: control?.address()?.port || 0,
    token: config.token,
  });
}

async function shutdown(failedExit = false) {
  if (closing) return;
  closing = true;
  // helper 句柄持有 Windows Job：杀掉它即终止脚本及其全部子进程，不会误伤其他程序。
  if (helper && helper.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      helper.once('exit', () => { clearTimeout(timer); resolve(); });
      helper.kill();
    });
  }
  control?.close();
  setTimeout(() => app.exit(failedExit ? 1 : 0), 150).unref();
}

function fail(reason) {
  if (closing) return;
  error = String(reason?.message || reason).slice(0, 500);
  status = 'failed';
  publish();
  void shutdown(true);
}

function settle(code) {
  if (closing) return;
  exitCode = Number.isInteger(code) ? code : null;
  finishedAt = new Date().toISOString();
  if (exitCode === 0) { status = 'stopped'; error = ''; }
  else { status = 'failed'; error = `脚本退出码 ${exitCode ?? '未知'}，请查看日志`; }
  publish();
  void shutdown(exitCode !== 0);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.on('before-quit', event => { if (!closing) { event.preventDefault(); void shutdown(); } });

async function start() {
  await app.whenReady();

  control = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${config.token}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      res.writeHead(403); res.end('{}'); return;
    }
    if (req.method === 'GET' && req.url === '/status') { res.end(JSON.stringify({ instanceId: config.instanceId, status, error, exitCode, startedAt, finishedAt })); return; }
    if (req.method === 'POST' && req.url === '/stop') {
      res.end('{}');
      if (!closing) { status = 'stopped'; error = ''; exitCode = null; finishedAt = new Date().toISOString(); publish(); void shutdown(); }
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));

  const readyFile = path.join(config.runDir, 'ready');
  if (fs.existsSync(readyFile)) fs.unlinkSync(readyFile);
  const jobConfig = path.join(config.runDir, 'job.json');
  // port = 0 → job.ps1 跳过端口就绪探测，只跟踪脚本进程的存活与退出码。
  atomicJson(jobConfig, { executable: config.executable, args: config.args, directory: config.directory, log: config.log, port: 0, readyFile, ownerPid: process.pid });

  status = 'starting';
  publish();

  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  helper = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'job.ps1'), '-Configuration', jobConfig], {
    cwd: config.directory, windowsHide: true, env: cleanEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  helper.stdout.on('data', chunk => { try { fs.appendFileSync(config.log, chunk); } catch {} });
  helper.stderr.on('data', chunk => { try { fs.appendFileSync(config.log, chunk); } catch {} });
  helper.once('spawn', () => { if (!closing) { startedAt = new Date().toISOString(); status = 'running'; publish(); } });
  helper.on('error', fail);
  helper.on('exit', code => settle(code));
}

void start().catch(fail);
