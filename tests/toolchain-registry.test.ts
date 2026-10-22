import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createToolchain } = createRequire(import.meta.url)('../desktop/toolchain/manager.cjs');
let directory: string;
const create = () => createToolchain({ directory, app: { getFileIcon: async () => ({ toDataURL: () => 'data:image/png;base64,test' }) }, shell: {} });
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'byqx-toolchain-registry-')); });
afterEach(() => { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe cleanup'); fs.rmSync(directory, { recursive: true, force: true }); });
it('serializes concurrent registration, favorites and ordering, restores on restart', async () => {
  const store = create();
  const values = await Promise.all(['first', 'second', 'third'].map(name => store.operation('save', { kind: 'web', name, url: `https://example.com/${name}` })));
  expect((await store.operation('list')).length).toBe(3);
  await Promise.all(values.map(value => store.operation('favorite', { id: value.id })));
  const ids = values.map(value => value.id).reverse(); await store.operation('reorder', { ids });
  const restarted: Array<{ id: string; favorite: boolean }> = await create().operation('list'); expect(restarted.map(value => value.id)).toEqual(ids); expect(restarted.every(value => value.favorite)).toBe(true);
  await expect(store.operation('reorder', { ids: [ids[0], ids[0], ids[0]] })).rejects.toThrow('排序');
  expect((await store.operation('list')).map((value: { id: string }) => value.id)).toEqual(ids);
});
it('does not delete original files when removing software registration', async () => {
  const file = path.join(directory, 'fixture.exe'); fs.writeFileSync(file, 'fixture');
  const store = create(), entry = await store.operation('save', { kind: 'software', name: 'fixture', path: file });
  await store.operation('remove', { id: entry.id }); expect(fs.readFileSync(file, 'utf8')).toBe('fixture'); expect(await store.operation('list')).toEqual([]);
});
it('refuses a corrupt registry instead of silently replacing it', () => { fs.writeFileSync(path.join(directory, 'registry.json'), 'broken'); expect(create).toThrow('损坏'); expect(fs.readFileSync(path.join(directory, 'registry.json'), 'utf8')).toBe('broken'); });
it('registers and removes a script entry without touching the script file', async () => {
  const script = path.join(directory, 'backup.ps1'); fs.writeFileSync(script, 'Write-Output 1');
  const store = create(), entry = await store.operation('save', { kind: 'script', name: '备份', path: script, arguments: '-Mode fast' });
  expect(entry.kind).toBe('script'); expect(entry.path).toBe(fs.realpathSync(script)); expect(entry.workingDirectory).toBe(fs.realpathSync(directory));
  const listed: Array<{ kind: string; status: string }> = await store.operation('list');
  expect(listed[0]).toMatchObject({ kind: 'script', status: 'stopped' });
  await store.operation('remove', { id: entry.id });
  expect(await store.operation('list')).toEqual([]);
  expect(fs.readFileSync(script, 'utf8')).toBe('Write-Output 1');
});
it('rejects script entries whose file is missing or not a .ps1', async () => {
  const store = create(), bat = path.join(directory, 'run.bat'); fs.writeFileSync(bat, 'echo 1');
  await expect(store.operation('save', { kind: 'script', name: 'x', path: bat })).rejects.toThrow('.ps1');
  await expect(store.operation('save', { kind: 'script', name: 'x', path: path.join(directory, 'missing.ps1') })).rejects.toThrow();
});
it('surfaces the last exit code and run window of a script entry', async () => {
  const script = path.join(directory, 'task.ps1'); fs.writeFileSync(script, 'Write-Output 1');
  const store = create(), entry = await store.operation('save', { kind: 'script', name: '任务', path: script });
  const runDir = path.join(directory, 'runs', entry.id); fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({ status: 'stopped', error: '', exitCode: 3, startedAt: '2026-10-18T03:00:00.000Z', finishedAt: '2026-10-18T03:00:07.000Z' }));
  const [listed] = await store.operation('list');
  expect(listed).toMatchObject({ status: 'stopped', exitCode: 3, startedAt: '2026-10-18T03:00:00.000Z', finishedAt: '2026-10-18T03:00:07.000Z' });
});
it('retains the previous registration when persistence fails', async () => {
  const store = create(); await store.operation('save', { kind: 'web', name: 'saved', url: 'https://example.com' });
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(Error('disk write unavailable'), { code: 'EIO' }); });
  try { await expect(store.operation('save', { kind: 'web', name: 'unsaved', url: 'https://example.com/new' })).rejects.toThrow('disk write'); }
  finally { rename.mockRestore(); }
  expect((await store.operation('list')).map((item: { name: string }) => item.name)).toEqual(['saved']);
  expect((await create().operation('list')).map((item: { name: string }) => item.name)).toEqual(['saved']);
});
const createWith = (shell: unknown) => createToolchain({ directory, app: { getFileIcon: async () => ({ toDataURL: () => 'data:image/png;base64,test' }) }, shell });
it('stores pasted script code as a card without creating any source file', async () => {
  const store = create();
  const entry = await store.operation('save', { kind: 'script', mode: 'inline', name: '临时脚本', code: 'Write-Output 42' });
  expect(entry).toMatchObject({ kind: 'script', mode: 'inline', code: 'Write-Output 42' });
  expect(entry.path).toBeUndefined();
  const [listed] = await store.operation('list') as Array<{ status: string; invalid: boolean }>;
  expect(listed).toMatchObject({ status: 'stopped', invalid: false });
  await store.operation('remove', { id: entry.id });
  expect(await store.operation('list')).toEqual([]);
  expect(fs.readdirSync(directory)).toEqual(['registry.json']);
  expect(JSON.parse(fs.readFileSync(path.join(directory, 'registry.json'), 'utf8')).entries).toEqual([]);
});
it('opens the run directory for pasted code instead of a source folder', async () => {
  const opened: string[] = [];
  const store = createWith({ openPath: async (target: string) => { opened.push(target); return ''; } });
  const entry = await store.operation('save', { kind: 'script', mode: 'inline', name: '内联', code: 'Write-Output 1' });
  await store.operation('folder', { id: entry.id });
  expect(opened).toEqual([path.join(directory, 'runs', entry.id)]);
  expect(fs.existsSync(opened[0]!)).toBe(true);
});
it('switches a script card between a source file and pasted code', async () => {
  const script = path.join(directory, 'task.ps1'); fs.writeFileSync(script, 'Write-Output 1');
  const store = create();
  const saved = await store.operation('save', { kind: 'script', name: 'x', path: script });
  const inline = await store.operation('save', { ...saved, mode: 'inline', code: 'Write-Output 2' });
  expect(inline.path).toBeUndefined();
  expect(inline.code).toBe('Write-Output 2');
  const back = await store.operation('save', { ...inline, mode: 'file', path: script });
  expect(back.code).toBeUndefined();
  expect(back.path).toBe(fs.realpathSync(script));
});
