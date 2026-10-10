/** Local-only OAuth credentials. Not part of settings, exports or cloud sync. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Credential, CredentialStore, AuthOperationOptions } from '@earendil-works/pi-ai';
import type { ChatGptRegistration } from './chatgpt-oauth';

type State = { hostId: string; credentials: Record<string, Credential>; registration?: ChatGptRegistration };
export function subscriptionFile() {
  if (process.env.BYQX_PI_AUTH_PATH) return path.resolve(process.env.BYQX_PI_AUTH_PATH);
  if (process.env.BYQX_CONFIG_PATH) return path.join(path.dirname(process.env.BYQX_CONFIG_PATH), 'pi-auth.json');
  return path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'byqx-blog-desktop', 'pi-auth.json');
}

export class LocalSubscriptionStore implements CredentialStore {
  constructor(readonly file: string) {}
  private async load(): Promise<State> {
    try {
      const state = JSON.parse(await fs.readFile(this.file, 'utf8')) as State;
      if (!state.hostId || !state.credentials || typeof state.credentials !== 'object') throw new Error('Invalid local auth file');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { hostId: randomUUID(), credentials: {} };
    }
  }
  /** Exclusive file creation serializes rotating refresh tokens across processes too. */
  private async locked<T>(fn: (state: State) => Promise<T>, signal?: AbortSignal): Promise<T> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const lockFile = `${this.file}.lock`;
    const started = Date.now();
    let handle;
    while (!handle) {
      signal?.throwIfAborted();
      try {
        handle = await fs.open(lockFile, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Recover only a lock whose owning process has definitely exited.
        try {
          const { pid } = JSON.parse(await fs.readFile(lockFile, 'utf8')) as { pid: number };
          if (Number.isInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); }
            catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') await fs.unlink(lockFile).catch(() => {}); }
          }
        } catch { /* A new owner may still be writing its lock. */ }
        if (Date.now() - started > 60_000) throw new Error('订阅凭据正在使用，请稍后重试');
        await new Promise(resolve => setTimeout(resolve, 80));
      }
    }
    let temp: string | undefined;
    try {
      const state = await this.load();
      signal?.throwIfAborted();
      const result = await fn(state);
      // Once token rotation has completed, persist it even if the caller stopped waiting.
      temp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(temp, this.file);
      return result;
    } finally {
      if (temp) await fs.unlink(temp).catch(() => {});
      await handle.close();
      await fs.unlink(lockFile);
    }
  }
  async hostId() { return this.locked(async state => state.hostId); }
  async registration() { return (await this.load()).registration; }
  async read(providerId: string, options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    return structuredClone((await this.load()).credentials[providerId]);
  }
  async list(options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    return Object.entries((await this.load()).credentials).map(([providerId, c]) => ({ providerId, type: c.type }));
  }
  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions) {
    return this.locked(async state => {
      const next = await fn(structuredClone(state.credentials[providerId]));
      if (next) state.credentials[providerId] = next;
      // Pi returns undefined when another request has already refreshed: it means no change.
      if (providerId === 'openai' && next?.type === 'oauth' && typeof next.clientId === 'string' && typeof next.subject === 'string') state.registration = { clientId: next.clientId, subject: next.subject };
      return structuredClone(state.credentials[providerId]);
    }, options?.signal);
  }
  async delete(providerId: string, options?: AuthOperationOptions) {
    await this.locked(async state => { delete state.credentials[providerId]; }, options?.signal);
  }
}
