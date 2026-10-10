'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { atomicJson, jsonFile, validateEntry, projectMetadata, softwarePath, existingPath, resolveCommand, cleanEnvironment, findNode, webUrl } = require('./core.cjs');

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
  async function contact(id, action = 'status') {
    const state = jsonFile(stateFile(id), null);
    if (!state?.controlPort || !state.token) return { status: state?.status === 'failed' ? 'failed' : 'stopped', error: state?.error || '' };
    try {
      const response = await fetch(`http://127.0.0.1:${state.controlPort}/${action}`, { method: action === 'status' ? 'GET' : 'POST', headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw Error('实例验证失败');
      const result = await response.json();
      if (action === 'status' && result.instanceId !== state.instanceId) throw Error('实例已失效');
      return { ...result, connected: true };
    } catch {
      // A window may have published "stopped" between reading its address and
      // connecting. Re-read before classifying a closed control socket as a crash.
      const latest = jsonFile(stateFile(id), state);
      return { status: ['failed', 'checking', 'starting', 'running'].includes(latest?.status) ? 'failed' : 'stopped', error: latest?.status === 'failed' ? latest.error : ['checking', 'starting', 'running'].includes(latest?.status) ? '工具窗口进程已结束或实例无法连接，请查看日志后重新启动' : '' };
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
  function saveRegistry() { atomicJson(registryFile, { version: 1, entries }); }
  async function stop(id) {
    await contact(id, 'stop');
    for (let i = 0; i < 30; i++) { if (!(await contact(id)).connected) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw Error('停止尚未完成，请稍后重试；不会终止未经验证的进程');
  }
  async function launch(entry) {
    if (entry.kind === 'web') { await shell.openExternal(webUrl(entry.url)); return; }
    if (entry.kind === 'software') { await inspectSoftware(entry.path); const error = await shell.openPath(entry.path); if (error) throw Error(error); return; }
    if (active.has(entry.id)) return active.get(entry.id);
    const task = (async () => {
      const state = await contact(entry.id);
      if (['checking', 'starting', 'running'].includes(state.status)) { await contact(entry.id, 'focus'); return; }
      if (state.connected) await stop(entry.id);
      const recipe = resolveCommand(existingPath(entry.path, true), entry.command);
      const url = webUrl(entry.url, true);
      const sources = ['core.cjs', 'runner.cjs', 'job.ps1'];
      const version = crypto.createHash('sha256').update(sources.map(file => fs.readFileSync(path.join(__dirname, file))).join('')).digest('hex').slice(0, 16);
      const runtime = path.join(directory, 'runtime', version);
      fs.mkdirSync(runtime, { recursive: true });
      for (const file of sources) {
        if (file === 'job.ps1') fs.writeFileSync(path.join(runtime, file), '\uFEFF' + fs.readFileSync(path.join(__dirname, file), 'utf8'));
        else fs.copyFileSync(path.join(__dirname, file), path.join(runtime, file));
      }
      atomicJson(path.join(runtime, 'package.json'), { name: 'byqx-toolchain-runner', version: '1.0.0', main: 'runner.cjs' });
      const runDir = path.join(directory, 'runs', entry.id);
      fs.mkdirSync(runDir, { recursive: true });
      if (fs.existsSync(stateFile(entry.id))) fs.unlinkSync(stateFile(entry.id));
      for (const name of ['service.log', 'runner.log']) { const file = path.join(runDir, name); if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, `${file}.previous`); }
      const configFile = path.join(runDir, 'launch.json');
      atomicJson(configFile, { id: entry.id, instanceId: crypto.randomUUID(), token: crypto.randomBytes(32).toString('hex'), name: entry.name, directory: entry.path, url, ...recipe, log: path.join(runDir, 'service.log'), runDir, profile: path.join(directory, 'profiles', entry.id), stateFile: stateFile(entry.id) });
      // Detached, private environment and no inherited stdio: exiting the blog
      // cannot take this tool with it. The helper job belongs to this runner.
      const log = fs.openSync(path.join(runDir, 'runner.log'), 'a');
      const args = app.isPackaged ? ['--toolchain-runner', path.join(runtime, 'runner.cjs'), configFile] : [runtime, configFile];
      const child = spawn(process.execPath, args, { detached: true, windowsHide: false, stdio: ['ignore', log, log], cwd: runtime, env: cleanEnvironment() });
      fs.closeSync(log);
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      for (let i = 0; i < 80; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const status = await contact(entry.id);
        if (['checking', 'starting', 'running'].includes(status.status)) return;
        if (status.status === 'failed') throw Error(status.error);
      }
      throw Error('工具窗口进程未响应，请查看运行日志');
    })();
    active.set(entry.id, task);
    try { return await task; } finally { active.delete(entry.id); }
  }
  async function operation(action, input = {}) {
    if (action === 'list') return Promise.all(entries.map(async entry => ({ ...entry, ...(entry.kind === 'source' ? await contact(entry.id) : { status: 'ready' }), invalid: entry.path ? !fs.existsSync(entry.path) : false })));
    if (action === 'inspect-software') return inspectSoftware(input.path);
    if (action === 'inspect-project') return inspectProject(input.path);
    if (action === 'save') {
      const previous = input.id ? get(input.id) : {};
      if (previous.id && previous.kind === 'source' && ['checking', 'starting', 'running'].includes((await contact(previous.id)).status)) throw Error('请先停止项目，再修改启动配置');
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
    if (action === 'stop' || action === 'restart') { if (entry.kind !== 'source') throw Error('此工具不由博客管理服务'); await stop(entry.id); if (action === 'restart') return launch(entry); return; }
    if (action === 'remove') { if (entry.kind === 'source') await stop(entry.id); entries = entries.filter(item => item.id !== entry.id); saveRegistry(); return; }
    if (action === 'favorite') { entry.favorite = !entry.favorite; saveRegistry(); return; }
    if (action === 'folder') { if (!entry.path) throw Error('网页工具没有本机目录'); const result = await shell.openPath(entry.kind === 'source' ? existingPath(entry.path, true) : path.dirname(existingPath(entry.path))); if (result) throw Error(result); return; }
    if (action === 'logs') {
      if (entry.kind !== 'source') throw Error('此工具没有启动日志');
      return ['service.log', 'runner.log'].map(name => { const file = path.join(directory, 'runs', entry.id, name); if (!fs.existsSync(file)) return `${name}: 暂无日志`; const fd = fs.openSync(file, 'r'); try { const size = fs.fstatSync(fd).size, buffer = Buffer.alloc(Math.min(size, 32000)); fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length)); return `${name}\n${buffer.toString('utf8')}`; } finally { fs.closeSync(fd); } }).join('\n\n');
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
