import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { startServerProcess } = createRequire(import.meta.url)('../desktop/server-process.cjs');

function setup(timeoutMs = 1000) {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), stdout: new EventEmitter(), stderr: new EventEmitter() });
  const onExit = vi.fn();
  const fork = vi.fn((_module: string, _args: string[], _options: Record<string, unknown>) => child);
  const server = startServerProcess({ fork, modulePath: 'server.cjs', args: ['entry.mjs', 'local.db', 'template.db'], env: { HOST: '127.0.0.1' }, cwd: '/app', onExit, timeoutMs });
  return { child, onExit, fork, server };
}

describe('desktop service lifecycle', () => {
  it('waits for child initialization and forwards runtime environment', async () => {
    const { child, fork, server } = setup();
    child.emit('message', { type: 'ready' });
    await server.started;
    expect(fork.mock.calls[0]?.[2]).toMatchObject({ env: { HOST: '127.0.0.1' }, cwd: '/app' });
    server.stop();
    server.stop();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it('reports initialization error and terminates partially started service', async () => {
    const { child, server } = setup();
    const result = expect(server.started).rejects.toThrow('bad database');
    child.emit('message', { type: 'startup-error', message: 'bad database' });
    await result;
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('rejects early exit rather than waiting until timeout', async () => {
    const { child, server } = setup();
    const result = expect(server.started).rejects.toThrow('提前退出');
    child.emit('exit', 1);
    await result;
  });
  it('reports unexpected exit but ignores intentional app shutdown', async () => {
    const { child, onExit, server } = setup();
    child.emit('message', { type: 'ready' });
    await server.started;
    child.emit('exit', 7);
    expect(onExit).toHaveBeenCalledWith(7);
    server.stop();
    child.emit('exit', 0);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it('kills a service that never completes startup', async () => {
    const { child, server } = setup(15);
    await expect(server.started).rejects.toThrow('初始化超时');
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
