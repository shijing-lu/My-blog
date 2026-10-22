'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { atomicJson, jsonFile, validateEntry, projectMetadata, softwarePath, scriptPath, inlineScript, writeInlineScript, decodeLogBuffer, existingPath, resolveCommand, cleanEnvironment, findNode, webUrl, tokenizeArguments } = require('./core.cjs');

function createToolchain({ directory, app, shell, nativeImage }) {
  fs.mkdirSync(directory, { recursive: true });
  const registryFile = path.join(directory, 'registry.json');
  const saved = fs.existsSync(registryFile) ? jsonFile(registryFile, null) : { version: 1, entries: [] };
  if (!saved || saved.version !== 1) throw Error('工具登记文件损坏或版本不支持，请保留文件后手动恢复');
  let entries = saved.entries;
  if (!Array.isArray(entries)) throw Error('工具登记文件损坏，请保留文件后手动恢复');
  let queue = Promise.resolve();
  const active = new Map();
  const stateFile = id => path.join(directory, 'runs', id, 'state.json');
  const get = id => { const entry = entries.find(item => item.id === id); if (!entry) throw Error('工具不存在，请刷新列表'); return entry; };
  // 运行时长与退出码只用于展示，缺省一律给 null / 空串，前端据此隐藏字段。
  const timing = value => ({ exitCode: value?.exitCode ?? null, startedAt: value?.startedAt || '', finishedAt: value?.finishedAt || '' });
  async function contact(id, action = 'status') {
    const state = jsonFile(stateFile(id), null);
    if (!state?.controlPort || !state.token) return { status: state?.status === 'failed' ? 'failed' : 'stopped', error: state?.error || '', ...timing(state) };
    try {
      const response = await fetch(`http://127.0.0.1:${state.controlPort}/${action}`, { method: action === 'status' ? 'GET' : 'POST', headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw Error('实例验证失败');
      const result = await response.json();
      if (action === 'status' && result.instanceId !== state.instanceId) throw Error('实例已失效');
      return { ...result, ...timing({ ...state, ...result }), connected: true };
    } catch {
      // A window may have published "stopped" between reading its address and
      // connecting. Re-read before classifying a closed control socket as a crash.
      const latest = jsonFile(stateFile(id), state);
      return { status: ['failed', 'checking', 'starting', 'running'].includes(latest?.status) ? 'failed' : 'stopped', error: latest?.status === 'failed' ? latest.error : ['checking', 'starting', 'running'].includes(latest?.status) ? '工具窗口进程已结束或实例无法连接，请查看日志后重新启动' : '', ...timing(latest) };
    }
  }
  async function inspectSoftware(value) {
    const file = softwarePath(value);
    let target = file, shortcut = null;
    if (path.extname(file).toLowerCase() === '.lnk') { shortcut = shell.readShortcutLink(file); target = shortcut.target; if (!target || !fs.existsSync(target)) throw Error('快捷方式目标已失效，请重新定位软件'); }
    let icon = '';
    try {
      const custom = shortcut?.icon && nativeImage ? nativeImage.createFromPath(shortcut.icon) : null;
      icon = custom && !custom.isEmpty() ? custom.resize({ width: 48, height: 48 }).toDataURL() : (await app.getFileIcon(target, { size: 'large' })).toDataURL();
    } catch { try { icon = (await app.getFileIcon(file, { size: 'large' })).toDataURL(); } catch {} }
    return { path: file, name: path.basename(file, path.extname(file)), target, workingDirectory: shortcut?.cwd || '', arguments: shortcut?.args || '', icon };
  }
  async function inspectProject(value) {
    const metadata = projectMetadata(value);
    const node = findNode();
    const detected = node ? spawnSync(node, ['--version'], { timeout: 3000, windowsHide: true, env: cleanEnvironment(), encoding: 'utf8' }) : null;
    const nodeVersion = detected?.status === 0 ? detected.stdout.trim() : '';
    let environment = nodeVersion ? `已找到 Node.js ${nodeVersion}` : '未找到可运行的 Node.js，请手动安装后重新打开博客';
    if (metadata.suggestion.command && node) { try { resolveCommand(metadata.directory, metadata.suggestion.command, node); } catch (err) { environment = err.message; } }
    return { ...metadata, node, nodeVersion, environment };
  }
  async function inspectScript(value) {
    // 粘贴代码只校验并回显摘要，不创建任何文件；真正落地发生在启动时。
    if (value && typeof value.code === 'string') {
      const code = inlineScript(value.code);
      return { mode: 'inline', path: '', name: '', directory: '', size: Buffer.byteLength(code, 'utf8'), lines: code.split('\n').length, modifiedAt: '' };
    }
    const file = scriptPath(value && value.path);
    const stat = fs.statSync(file);
    const text = fs.readFileSync(file, 'utf8');
    return { mode: 'file', path: file, name: path.basename(file, path.extname(file)), directory: path.dirname(file), size: stat.size, lines: text.split('\n').length, modifiedAt: stat.mtime.toISOString() };
  }
  /** 内联脚本的落地位置：每次启动前重写，保证卡片运行的是登记文件里的最新代码。 */
  function writeInline(entry) {
    return writeInlineScript(path.join(directory, 'runs', entry.id, 'inline.ps1'), entry.code);
  }
  function scriptWorkdir(entry) {
    if (entry.workingDirectory && fs.existsSync(entry.workingDirectory)) return existingPath(entry.workingDirectory, true);
    return entry.mode === 'inline' ? os.homedir() : path.dirname(scriptPath(entry.path));
  }
  function saveRegistry() { atomicJson(registryFile, { version: 1, entries }); }
  async function stop(id) {
    await contact(id, 'stop');
    for (let i = 0; i < 30; i++) { if (!(await contact(id)).connected) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw Error('停止尚未完成，请稍后重试；不会终止未经验证的进程');
  }
  /** 源码项目与脚本启动共用一套「独立宿主进程 + 版本化 runtime」的启动流程。 */
  async function startRunner(entry, kind, config) {
    const sources = kind === 'script' ? ['core.cjs', 'script-runner.cjs', 'job.ps1'] : ['core.cjs', 'runner.cjs', 'job.ps1'];
    const main = kind === 'script' ? 'script-runner.cjs' : 'runner.cjs';
    const version = crypto.createHash('sha256').update(sources.map(file => fs.readFileSync(path.join(__dirname, file))).join('')).digest('hex').slice(0, 16);
    const runtime = path.join(directory, 'runtime', version);
    fs.mkdirSync(runtime, { recursive: true });
    for (const file of sources) {
      if (file === 'job.ps1') fs.writeFileSync(path.join(runtime, file), '\uFEFF' + fs.readFileSync(path.join(__dirname, file), 'utf8'));
      else fs.copyFileSync(path.join(__dirname, file), path.join(runtime, file));
    }
    atomicJson(path.join(runtime, 'package.json'), { name: 'byqx-toolchain-runner', version: '1.0.0', main });
    const runDir = path.join(directory, 'runs', entry.id);
    fs.mkdirSync(runDir, { recursive: true });
    if (fs.existsSync(stateFile(entry.id))) fs.unlinkSync(stateFile(entry.id));
    for (const name of ['service.log', 'runner.log']) { const file = path.join(runDir, name); if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, `${file}.previous`); }
    const configFile = path.join(runDir, 'launch.json');
    atomicJson(configFile, { id: entry.id, instanceId: crypto.randomUUID(), token: crypto.randomBytes(32).toString('hex'), name: entry.name, log: path.join(runDir, 'service.log'), runDir, profile: path.join(directory, 'profiles', entry.id), stateFile: stateFile(entry.id), ...config });
    // Detached, private environment and no inherited stdio: exiting the blog
    // cannot take this tool with it. The helper job belongs to this runner.
    const log = fs.openSync(path.join(runDir, 'runner.log'), 'a');
    const args = app.isPackaged ? [kind === 'script' ? '--toolchain-script-runner' : '--toolchain-runner', path.join(runtime, main), configFile] : [runtime, configFile];
    const child = spawn(process.execPath, args, { detached: true, windowsHide: false, stdio: ['ignore', log, log], cwd: runtime, env: cleanEnvironment() });
    fs.closeSync(log);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    for (let i = 0; i < 80; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const status = await contact(entry.id);
      if (['checking', 'starting', 'running'].includes(status.status)) return;
      if (status.status === 'failed') throw Error(status.error);
      // 一次性脚本可能在宿主就绪前就跑完：只有宿主真的发布过状态文件，
      // 「stopped」才代表跑完；否则只是还没启动（状态文件在启动前已删除）。
      if (kind === 'script' && status.status === 'stopped' && fs.existsSync(stateFile(entry.id))) return;
    }
    throw Error(kind === 'script' ? '脚本进程未响应，请查看日志' : '工具窗口进程未响应，请查看运行日志');
  }
  async function launch(entry) {
    if (entry.kind === 'web') { await shell.openExternal(webUrl(entry.url)); return; }
    if (entry.kind === 'software') { await inspectSoftware(entry.path); const error = await shell.openPath(entry.path); if (error) throw Error(error); return; }
    if (active.has(entry.id)) return active.get(entry.id);
    const task = (async () => {
      const state = await contact(entry.id);
      if (['checking', 'starting', 'running'].includes(state.status)) {
        if (entry.kind === 'source') await contact(entry.id, 'focus');
        return;
      }
      if (state.connected) await stop(entry.id);
      if (entry.kind === 'script') {
        const script = entry.mode === 'inline' ? writeInline(entry) : scriptPath(entry.path);
        const workdir = scriptWorkdir(entry);
        const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
        if (!fs.existsSync(powershell)) throw Error('未找到 Windows PowerShell，无法运行脚本');
        return startRunner(entry, 'script', {
          directory: workdir,
          executable: powershell,
          args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...tokenizeArguments(entry.arguments || '')],
        });
      }
      const recipe = resolveCommand(existingPath(entry.path, true), entry.command);
      const url = webUrl(entry.url, true);
      return startRunner(entry, 'source', { directory: entry.path, url, ...recipe });
    })();
    active.set(entry.id, task);
    try { return await task; } finally { active.delete(entry.id); }
  }
  async function operation(action, input = {}) {
    if (action === 'list') return Promise.all(entries.map(async entry => ({ ...entry, ...(['source', 'script'].includes(entry.kind) ? await contact(entry.id) : { status: 'ready' }), invalid: entry.path ? !fs.existsSync(entry.path) : false })));
    if (action === 'inspect-software') return inspectSoftware(input.path);
    if (action === 'inspect-project') return inspectProject(input.path);
    if (action === 'inspect-script') return inspectScript(input);
    if (action === 'save') {
      const previous = input.id ? get(input.id) : {};
      if (previous.id && ['source', 'script'].includes(previous.kind) && ['checking', 'starting', 'running'].includes((await contact(previous.id)).status)) throw Error('请先停止该项目或脚本，再修改启动配置');
      const value = validateEntry(input, previous);
      if (value.kind === 'software') value.icon = (await inspectSoftware(value.path)).icon;
      if (previous.id) entries = entries.map(entry => entry.id === previous.id ? value : entry); else entries.push(value);
      saveRegistry(); return value;
    }
    if (action === 'reorder') {
      if (!Array.isArray(input.ids) || input.ids.length !== entries.length || new Set(input.ids).size !== entries.length || input.ids.some(id => !entries.some(entry => entry.id === id))) throw Error('排序信息已过期，请刷新后重试');
      entries = input.ids.map(id => get(id)); saveRegistry(); return;
    }
    const entry = get(input.id);
    if (action === 'launch') return launch(entry);
    if (action === 'stop' || action === 'restart') { if (!['source', 'script'].includes(entry.kind)) throw Error('此工具不由博客管理服务'); await stop(entry.id); if (action === 'restart') return launch(entry); return; }
    if (action === 'remove') { if (['source', 'script'].includes(entry.kind)) await stop(entry.id); entries = entries.filter(item => item.id !== entry.id); saveRegistry(); return; }
    if (action === 'favorite') { entry.favorite = !entry.favorite; saveRegistry(); return; }
    if (action === 'folder') {
      // 内联脚本没有源文件所在目录，退回到它的运行目录（日志与 inline.ps1 都在这里）。
      if (entry.kind === 'web') throw Error('网页工具没有本机目录');
      const inline = entry.kind === 'script' && entry.mode === 'inline';
      const target = entry.kind === 'source' ? existingPath(entry.path, true) : inline ? path.join(directory, 'runs', entry.id) : path.dirname(existingPath(entry.path));
      if (inline) fs.mkdirSync(target, { recursive: true });
      const result = await shell.openPath(target); if (result) throw Error(result); return;
    }
    if (action === 'logs') {
      if (!['source', 'script'].includes(entry.kind)) throw Error('此工具没有启动日志');
      return ['service.log', 'runner.log'].map(name => {
        const file = path.join(directory, 'runs', entry.id, name);
        if (!fs.existsSync(file)) return `${name}: 暂无日志`;
        const fd = fs.openSync(file, 'r');
        try {
          const size = fs.fstatSync(fd).size, length = Math.min(size, 32000), from = Math.max(0, size - length);
          const buffer = Buffer.alloc(length);
          fs.readSync(fd, buffer, 0, length, from);
          // 只读尾部时可能从半行/半字符开始：跳过第一行残片，否则解码会带出一串乱码。
          const start = from > 0 ? buffer.indexOf(0x0a) + 1 : 0;
          return `${name}\n${decodeLogBuffer(buffer.subarray(start))}`;
        } finally { fs.closeSync(fd); }
      }).join('\n\n');
    }
    throw Error('不支持的工具操作');
  }
  return { operation(action, input) {
    if (['list', 'logs', 'inspect-software', 'inspect-project'].includes(action)) return operation(action, input);
    const task = queue.then(async () => {
      const snapshot = ['save', 'remove', 'favorite', 'reorder'].includes(action) ? JSON.stringify(entries) : null;
      try { return await operation(action, input); }
      catch (error) { if (snapshot !== null) entries = JSON.parse(snapshot); throw error; }
    }); queue = task.catch(() => {}); return task;
  } };
}
module.exports = { createToolchain };
