import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { projectMetadata, parseCommand, validateEntry, webUrl, cleanEnvironment, atomicJson, resolveCommand, tokenizeArguments, inlineScript, writeInlineScript, decodeLogBuffer } = require('../desktop/toolchain/core.cjs');
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'byqx-toolchain-test-')); fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { dev: 'vite --port 5123', start: 'node server.cjs' }, devDependencies: { vite: '1' } })); });
afterEach(() => { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe fixture cleanup'); fs.rmSync(directory, { recursive: true, force: true }); });
describe('toolchain metadata and command boundaries', () => {
  it('reads bounded startup files and preserves real scripts/port', () => { fs.writeFileSync(path.join(directory, 'README.md'), 'npm run dev\ntoken=secret-do-not-send'); fs.writeFileSync(path.join(directory, '.env'), 'PRIVATE_TEST=NEVER_SEND'); const value = projectMetadata(directory); expect(value.suggestion).toEqual({ command: 'npm run dev', url: 'http://127.0.0.1:5123' }); expect(JSON.stringify(value)).not.toContain('NEVER_SEND'); expect(value.readme).not.toContain('secret-do-not-send'); });
  it('rejects oversized startup documents', () => { fs.writeFileSync(path.join(directory, 'README.md'), 'a'.repeat(300000)); expect(() => projectMetadata(directory)).toThrow('过大'); });
  it.each(['npm run dev && calc', 'npm run dev; calc', 'node -e "foo"', 'powershell calc', 'npm install', 'npm run missing', 'npm run dev\ncalc', 'npm run dev | calc'])('rejects unreviewed arbitrary execution: %s', command => { expect(() => parseCommand(command, { dev: 'vite' })).toThrow(); });
  it('passes quoted arguments without shell interpolation', () => { expect(parseCommand('npm run dev -- --title "two words"', { dev: 'vite' }).args).toEqual(['run', 'dev', '--', '--title', 'two words']); });
  it('cannot use node to launch a sibling entry', () => { fs.writeFileSync(path.join(directory, 'ok.cjs'), ''); expect(() => resolveCommand(directory, 'node ../outside.cjs', process.execPath)).toThrow(); expect(resolveCommand(directory, 'node ok.cjs', process.execPath).args[0]).toBe(path.join(directory, 'ok.cjs')); });
  it.each(['file:///C:/Windows', 'javascript:alert(1)', 'https://user:secret@example.com', 'ftp://example.com'])('rejects unsupported web address %s', value => { expect(() => webUrl(value)).toThrow(); });
  it('requires local source URL, accepts external HTTP websites', () => { expect(() => webUrl('https://example.com', true)).toThrow(); expect(webUrl('http://127.0.0.1:5123', true)).toBe('http://127.0.0.1:5123/'); expect(webUrl('https://example.com')).toBe('https://example.com/'); });
  it('never inherits blog or subscription credentials', () => { expect(cleanEnvironment({ PATH: 'node', ADMIN_PASSWORD: 'secret', OPENAI_API_KEY: 'secret', SYNC_DATABASE_URL: 'secret', NODE_OPTIONS: '--require attacker', ELECTRON_RUN_AS_NODE: '1', SystemRoot: 'windows' })).toEqual({ PATH: 'node', SystemRoot: 'windows' }); });
  it('validates saved entries and refuses nonsoftware files', () => { expect(() => validateEntry({ kind: 'software', path: path.join(directory, 'package.json'), name: 'wrong' })).toThrow(); const value = validateEntry({ kind: 'source', path: directory, command: 'npm run dev', url: 'http://localhost:5123', name: ' Source ', tags: 'AI,AI,笔记', favorite: true }); expect(value.name).toBe('Source'); expect(value.tags).toEqual(['AI', '笔记']); expect(value.favorite).toBe(true); });
  it('writes versioned registry atomically without changing project', () => { const before = fs.readFileSync(path.join(directory, 'package.json'), 'utf8'); atomicJson(path.join(directory, 'registry.json'), { version: 1, entries: [] }); expect(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).toBe(before); expect(fs.readdirSync(directory).filter(file => file.endsWith('.tmp'))).toEqual([]); });
});
describe('script launch registration', () => {
  const write = (name: string, content = 'Write-Output 1') => { const file = path.join(directory, name); fs.writeFileSync(file, content); return file; };
  it('accepts a .ps1 script and defaults the working directory to its folder', () => {
    const file = write('task.ps1');
    const value = validateEntry({ kind: 'script', name: ' 备份脚本 ', path: file, arguments: '-Mode "fast run"' });
    expect(value.kind).toBe('script');
    expect(value.name).toBe('备份脚本');
    expect(value.path).toBe(fs.realpathSync(file));
    expect(value.workingDirectory).toBe(fs.realpathSync(directory));
    expect(value.arguments).toBe('-Mode "fast run"');
  });
  it('keeps an explicit working directory and refuses a missing one', () => {
    const file = write('task.ps1'), work = path.join(directory, 'sub'); fs.mkdirSync(work);
    expect(validateEntry({ kind: 'script', name: 'x', path: file, workingDirectory: work }).workingDirectory).toBe(fs.realpathSync(work));
    expect(() => validateEntry({ kind: 'script', name: 'x', path: file, workingDirectory: path.join(directory, 'missing') })).toThrow();
  });
  it.each(['task.bat', 'task.cmd', 'task.exe', 'task.txt', 'task.PS2'])('refuses a non PowerShell script: %s', name => {
    const file = write(name, 'echo 1');
    expect(() => validateEntry({ kind: 'script', name: 'x', path: file })).toThrow('.ps1');
  });
  it('refuses oversized scripts and nonstring arguments', () => {
    expect(() => validateEntry({ kind: 'script', name: 'x', path: write('huge.ps1', 'a'.repeat(600 * 1024)) })).toThrow('512KB');
    expect(() => tokenizeArguments(42)).toThrow('格式');
  });
  it.each(['-A; calc', '-A | calc', '-A > out.txt', '-A < in.txt', '-A\ncalc', '-A\r\ncalc'])('refuses shell metacharacters in arguments: %s', argumentsText => {
    expect(() => validateEntry({ kind: 'script', name: 'x', path: write('task.ps1'), arguments: argumentsText })).toThrow();
  });
  it('splits quoted arguments without evaluating a shell', () => {
    expect(tokenizeArguments('-Mode "fast run" -Count 3')).toEqual(['-Mode', 'fast run', '-Count', '3']);
    expect(tokenizeArguments('   ')).toEqual([]);
    expect(tokenizeArguments(undefined)).toEqual([]);
    expect(() => tokenizeArguments('-Mode "unclosed')).toThrow('引号');
  });
});
describe('pasted script code', () => {
  const write = (name: string, content = 'Write-Output 1') => { const file = path.join(directory, name); fs.writeFileSync(file, content); return file; };
  it('accepts pasted code without a source file and defaults to the user home', () => {
    const value = validateEntry({ kind: 'script', mode: 'inline', name: ' 清理临时文件 ', code: '  Write-Output "你好"\r\nRemove-Item *.tmp  ', arguments: '-Force' });
    expect(value.mode).toBe('inline');
    expect(value.name).toBe('清理临时文件');
    expect(value.path).toBeUndefined();
    expect(value.code).toBe('Write-Output "你好"\nRemove-Item *.tmp');
    expect(value.workingDirectory).toBe(os.homedir());
    expect(value.arguments).toBe('-Force');
  });
  it('keeps an explicit working directory for pasted code', () => {
    const work = path.join(directory, 'sub'); fs.mkdirSync(work);
    expect(validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 'Write-Output 1', workingDirectory: work }).workingDirectory).toBe(fs.realpathSync(work));
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 'Write-Output 1', workingDirectory: path.join(directory, 'missing') })).toThrow();
  });
  it('refuses empty, oversized, control-character and nonstring code', () => {
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: '  \r\n\t ' })).toThrow('粘贴');
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: undefined })).toThrow('粘贴');
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 42 })).toThrow('粘贴');
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 'a'.repeat(600 * 1024) })).toThrow('512KB');
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 'a\u0000b' })).toThrow('控制字符');
  });
  it('checks pasted code with the same 512KB budget as a .ps1 file', () => {
    const file = write('limit.ps1', 'a'.repeat(600 * 1024));
    expect(() => validateEntry({ kind: 'script', name: 'x', path: file })).toThrow('512KB');
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 'a'.repeat(600 * 1024) })).toThrow('512KB');
  });
  it('defaults an unspecified mode to a script file and still demands a .ps1 path', () => {
    const value = validateEntry({ kind: 'script', name: 'x', path: write('task.ps1') });
    expect(value.mode).toBe('file');
    expect(value.code).toBeUndefined();
    expect(() => validateEntry({ kind: 'script', name: 'x' })).toThrow('本机路径');
  });
  it('refuses invalid arguments for pasted code exactly like file entries', () => {
    expect(() => validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 'Write-Output 1', arguments: '-A; calc' })).toThrow();
    expect(validateEntry({ kind: 'script', mode: 'inline', name: 'x', code: 'Write-Output 1', arguments: '-Mode "fast run"' }).arguments).toBe('-Mode "fast run"');
  });
  it('normalizes pasted code the same way it is stored', () => {
    expect(inlineScript('  Write-Output "你好"\r\n  ')).toBe('Write-Output "你好"');
    expect(() => inlineScript('\n\n')).toThrow('粘贴');
  });
  it('writes the run copy as a BOM-prefixed .ps1 and creates missing folders', () => {
    const file = path.join(directory, 'runs', 'entry', 'inline.ps1');
    expect(writeInlineScript(file, '  Write-Output "中文"\r\n  ')).toBe(file);
    const bytes = fs.readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('Write-Output "中文"');
    expect(() => writeInlineScript(path.join(directory, 'runs', 'empty', 'inline.ps1'), '  ')).toThrow('粘贴');
  });
  it('decodes script logs whether the child wrote UTF-8 or the system GBK code page', () => {
    // 子进程 stdout 被 Start-Process 直接重定向，编码跟着子进程的 [Console]::OutputEncoding 走。
    expect(decodeLogBuffer(Buffer.from('中文输出：你好，世界', 'utf8'))).toBe('中文输出：你好，世界');
    expect(decodeLogBuffer(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))).toBe('你好');
    expect(decodeLogBuffer(Buffer.from('plain ascii', 'utf8'))).toBe('plain ascii');
    expect(decodeLogBuffer(Buffer.alloc(0))).toBe('');
  });
});
