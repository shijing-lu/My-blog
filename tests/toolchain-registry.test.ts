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
it('retains the previous registration when persistence fails', async () => {
  const store = create(); await store.operation('save', { kind: 'web', name: 'saved', url: 'https://example.com' });
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(Error('disk write unavailable'), { code: 'EIO' }); });
  try { await expect(store.operation('save', { kind: 'web', name: 'unsaved', url: 'https://example.com/new' })).rejects.toThrow('disk write'); }
  finally { rename.mockRestore(); }
  expect((await store.operation('list')).map((item: { name: string }) => item.name)).toEqual(['saved']);
  expect((await create().operation('list')).map((item: { name: string }) => item.name)).toEqual(['saved']);
});
