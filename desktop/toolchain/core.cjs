'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, file); break; }
      catch (error) {
        if (attempt >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        // Windows scanners/readers can briefly deny replacement. Retain the old
        // complete document and retry, never truncate it in place.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
      }
    }
  } finally { if (fs.existsSync(temp)) { try { fs.unlinkSync(temp); } catch {} } }
}
function jsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function existingPath(value, directory = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw Error('请选择有效的本机路径');
  let resolved, stat;
  try { resolved = fs.realpathSync(value.trim()); stat = fs.statSync(resolved); }
  catch { throw Error('文件或文件夹已失效或无法读取，请重新选择位置'); }
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error(directory ? '请选择项目文件夹' : '请选择文件');
  return resolved;
}
function softwarePath(value) {
  const resolved = existingPath(value);
  if (!['.exe', '.lnk'].includes(path.extname(resolved).toLowerCase())) throw Error('仅支持 .lnk 快捷方式或 .exe 程序');
  return resolved;
}
/** 脚本启动只接受 PowerShell 脚本；批处理需先包一层 .ps1，避免再引入 cmd.exe 这一层解释器。 */
function scriptPath(value) {
  const resolved = existingPath(value);
  if (path.extname(resolved).toLowerCase() !== '.ps1') throw Error('仅支持 .ps1 PowerShell 脚本；.bat / .cmd 请先包一层 .ps1');
  const stat = fs.statSync(resolved);
  if (stat.size > 512 * 1024) throw Error('脚本超过 512KB，请精简后再登记');
  return resolved;
}
/**
 * 内联脚本：直接粘贴的 PowerShell 代码，不落成用户文件。
 * 换行统一为 LF（PowerShell 两种都认），去掉首尾空行；上限与 .ps1 文件登记保持一致，
 * 避免单条登记把 registry.json 撑到无法原子改写。
 */
function inlineScript(value) {
  if (typeof value !== 'string') throw Error('请粘贴要运行的脚本代码');
  if (value.includes('\u0000')) throw Error('脚本代码含有无法保存的控制字符，请重新粘贴');
  const code = value.replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  if (!code) throw Error('请粘贴要运行的脚本代码');
  if (Buffer.byteLength(code, 'utf8') > 512 * 1024) throw Error('脚本超过 512KB，请精简后再登记');
  return code;
}
/**
 * 把粘贴的代码落成可执行的 .ps1。
 * Windows PowerShell 5.1 在无 BOM 时按 ANSI 读取脚本，中文与注释会乱码，因此必须写 BOM。
 */
function writeInlineScript(file, code) {
  const body = inlineScript(code);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '\uFEFF' + body, { mode: 0o600 });
  return file;
}
/**
 * 脚本日志解码。
 * job.ps1 用 Start-Process 把子进程 stdout 直接重定向进日志文件，子进程的
 * [Console]::OutputEncoding 是它自己的（中文 Windows 默认 GBK），不会继承 job.ps1。
 * 因此日志既可能是 UTF-8（脚本自己设过），也可能是 GBK：先严格按 UTF-8 判定，失败再回落。
 */
function decodeLogBuffer(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { try { return new TextDecoder('gbk').decode(buffer); } catch { return buffer.toString('utf8'); } }
}
function webUrl(value, local = false) {
  let url;
  try { url = new URL(value); } catch { throw Error('请输入完整的 HTTP / HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('仅支持不含账号密码的 HTTP / HTTPS 地址');
  if (local && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('源码项目地址必须为本机地址');
  if (url.href.length > 2048) throw Error('网址过长');
  return url.href;
}
// No shell evaluation: quotes are arguments, metacharacters/pipelines are rejected.
function splitQuoted(text, message) {
  const tokens = []; let current = '', quote = '', started = false;
  for (const char of text) {
    if (quote) { if (char === quote) quote = ''; else current += char; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started || current) { tokens.push(current); current = ''; started = false; } }
    else { current += char; started = true; }
  }
  if (quote) throw Error(message);
  if (started || current) tokens.push(current);
  return tokens;
}
function commandTokens(command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 1000 || /[\r\n;&|<>`$]/.test(command)) throw Error('请使用单条 npm / pnpm / yarn / node 命令；复杂命令请写入 package.json 的脚本');
  return splitQuoted(command.trim(), '启动命令的引号没有闭合');
}
/**
 * 脚本启动参数：整体交给 argv 数组，不经过任何 shell。
 * 只拒绝换行与控制型元字符（防止日后被拼进命令行时改变语义）；`$`/反引号在 argv 里是普通字符。
 */
function tokenizeArguments(text) {
  if (text === undefined || text === null) return [];
  if (typeof text !== 'string') throw Error('启动参数格式不正确');
  const value = text.trim();
  if (!value) return [];
  if (value.length > 500) throw Error('启动参数过长，请简化后再登记');
  if (/[\r\n;&|<>]/.test(value)) throw Error('启动参数只接受普通参数，不支持管道、重定向或命令串联；复杂逻辑请写进脚本');
  return splitQuoted(value, '启动参数的引号没有闭合');
}
function parseCommand(command, scripts = {}) {
  const tokens = commandTokens(command), manager = tokens.shift()?.replace(/\.cmd$/i, '').toLowerCase();
  if (!['npm', 'pnpm', 'yarn', 'node'].includes(manager)) throw Error('第一版支持 npm、pnpm、yarn 和 node 启动命令');
  if (manager === 'node') {
    if (!tokens[0] || tokens[0].startsWith('-') || !/\.(?:c?js|mjs)$/i.test(tokens[0])) throw Error('node 命令须指定项目内的 JavaScript 入口');
    return { manager, args: tokens };
  }
  const script = tokens[0] === 'run' ? tokens[1] : tokens[0];
  if (!script || !Object.prototype.hasOwnProperty.call(scripts, script)) throw Error('启动脚本不在当前 package.json 中，请重新分析或选择实际脚本');
  if (tokens[0] !== 'run' && manager === 'npm' && !['start', 'test', 'stop', 'restart'].includes(script)) throw Error('npm 自定义脚本请使用 npm run 脚本名');
  return { manager, args: tokens, script };
}
function redactStartup(text) {
  return text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [已隐藏]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|token|password|secret|authorization)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]')
    .replace(/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[已隐藏]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[已隐藏]@');
}
function projectMetadata(value) {
  const directory = existingPath(value, true);
  const read = (name, limit) => {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) return '';
    const resolved = fs.realpathSync(file);
    if (path.dirname(resolved).toLowerCase() !== directory.toLowerCase()) throw Error('启动文件指向项目目录之外，无法自动读取');
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > limit) throw Error(`${name} 过大或不是普通文件，请手动准备精简启动配置`);
    return fs.readFileSync(resolved, 'utf8');
  };
  let pkg;
  try { pkg = JSON.parse(read('package.json', 128 * 1024) || '{}'); }
  catch (error) { if (error instanceof SyntaxError) throw Error('package.json 格式不正确，请先在原项目修复'); throw error; }
  const scripts = Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([k, v]) => k.length <= 100 && typeof v === 'string' && v.length <= 1500));
  const locks = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb', 'bun.lock'].filter(name => fs.existsSync(path.join(directory, name)));
  const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 120);
  let readme = '';
  for (const name of ['README.md', 'readme.md', 'README.MD']) { if (fs.existsSync(path.join(directory, name))) { readme = read(name, 256 * 1024).slice(0, 7000); break; } }
  // Redact likely inline credentials even in allowed startup documents. Never read .env.
  const manager = locks.includes('pnpm-lock.yaml') ? 'pnpm' : locks.includes('yarn.lock') ? 'yarn' : 'npm';
  const script = ['dev', 'start', 'serve', 'preview'].find(name => scripts[name]);
  const portMatch = script && scripts[script].match(/(?:--port(?:=|\s+)|PORT=)(\d{2,5})/);
  const port = portMatch?.[1] || (dependencies.includes('vite') ? '5173' : dependencies.includes('astro') ? '4321' : '3000');
  return { directory, name: String(pkg.name || path.basename(directory)).slice(0, 80), scripts, engines: pkg.engines || {}, packageManager: pkg.packageManager || '', locks, dependencies, readme: redactStartup(readme), hasDependencies: fs.existsSync(path.join(directory, 'node_modules')), suggestion: { command: script ? `${manager} run ${script}` : '', url: `http://127.0.0.1:${port}` } };
}
function cleanEnvironment(source = process.env) {
  const names = new Set(['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'appdata', 'localappdata', 'userprofile', 'homedrive', 'homepath', 'programfiles', 'programfiles(x86)', 'programdata', 'os', 'pathext', 'number_of_processors', 'processor_architecture']);
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => names.has(key.toLowerCase()) && typeof value === 'string'));
  return env;
}
function findNode(env = process.env) {
  const candidates = [...(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'node.exe')), path.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')];
  return candidates.find(file => fs.existsSync(file)) || '';
}
function resolveCommand(directory, command, node = findNode()) {
  const metadata = projectMetadata(directory), recipe = parseCommand(command, metadata.scripts);
  if (!node || !fs.existsSync(node)) throw Error('未找到 Node.js，请安装 Node.js 并重新打开博客；不会自动安装环境');
  if (recipe.manager === 'node') {
    const entry = existingPath(path.resolve(directory, recipe.args[0]));
    if (!entry.toLowerCase().startsWith((directory + path.sep).toLowerCase())) throw Error('node 入口须位于所选项目中');
    return { executable: node, args: [entry, ...recipe.args.slice(1)] };
  }
  const files = recipe.manager === 'npm' ? [path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js')] : [path.join(process.env.APPDATA || '', `npm/node_modules/${recipe.manager}/bin/${recipe.manager === 'pnpm' ? 'pnpm.cjs' : 'yarn.js'}`), path.join(path.dirname(node), `node_modules/${recipe.manager}/bin/${recipe.manager === 'pnpm' ? 'pnpm.cjs' : 'yarn.js'}`)];
  const cli = files.find(file => fs.existsSync(file));
  if (!cli) throw Error(`未找到 ${recipe.manager}，请手动准备环境，或选择已安装的包管理器`);
  return { executable: node, args: [cli, ...recipe.args] };
}
function validateEntry(input, previous = {}) {
  if (!input || !['software', 'source', 'script', 'web'].includes(input.kind)) throw Error('工具类型不正确');
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw Error('请填写工具名称');
  const result = { id: previous.id || crypto.randomUUID(), kind: input.kind, name, category: String(input.category || '').trim().slice(0, 30), tags: [...new Set(String(input.tags || '').split(/[,，\s]+/).filter(Boolean))].slice(0, 8).map(tag => tag.slice(0, 24)), favorite: input.favorite === true, createdAt: previous.createdAt || new Date().toISOString() };
  if (input.kind === 'software') result.path = softwarePath(input.path);
  if (input.kind === 'web') result.url = webUrl(input.url);
  if (input.kind === 'source') {
    result.path = existingPath(input.path, true);
    result.command = String(input.command || '').trim();
    const metadata = projectMetadata(result.path);
    parseCommand(result.command, metadata.scripts);
    result.url = webUrl(input.url, true);
  }
  if (input.kind === 'script') {
    // 两种登记方式共用同一套启动流程：文件登记记 path，粘贴代码记 code，二者互斥。
    result.mode = input.mode === 'inline' ? 'inline' : 'file';
    // 参数只保留为 argv 数组原料（字符串），启动时再分词；不写入任何命令拼接结果。
    result.arguments = String(input.arguments || '').trim().slice(0, 500);
    tokenizeArguments(result.arguments);
    const directory = String(input.workingDirectory || '').trim();
    if (result.mode === 'inline') {
      result.code = inlineScript(input.code);
      // 内联脚本没有源文件可依据，默认工作目录取用户主目录，而不是工具链数据目录。
      result.workingDirectory = directory ? existingPath(directory, true) : os.homedir();
    } else {
      result.path = scriptPath(input.path);
      result.workingDirectory = directory ? existingPath(directory, true) : path.dirname(result.path);
    }
  }
  return result;
}
module.exports = { atomicJson, jsonFile, existingPath, softwarePath, scriptPath, inlineScript, writeInlineScript, decodeLogBuffer, webUrl, commandTokens, splitQuoted, tokenizeArguments, parseCommand, projectMetadata, redactStartup, cleanEnvironment, findNode, resolveCommand, validateEntry };
