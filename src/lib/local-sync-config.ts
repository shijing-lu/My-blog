import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import postgres from 'postgres';
import { serverEnv } from './env';

export interface CloudConnections { primaryUrl: string; fallbackUrl: string }
export class SyncConfigError extends Error {}
let saving = false;
export const syncConfigurationBusy = () => saving;
export const localAppMode = () => serverEnv('DESKTOP_MODE') === '1';
export function cloudConnections(): CloudConnections {
  return { primaryUrl: serverEnv('SYNC_DATABASE_URL'), fallbackUrl: serverEnv('SYNC_DATABASE_URL_FALLBACK') };
}
export function connectionSummary() {
  const { primaryUrl, fallbackUrl } = cloudConnections();
  return { primaryConfigured: !!primaryUrl, fallbackConfigured: !!fallbackUrl, cloudConfigured: !!primaryUrl };
}
function configPath(): string {
  if (!localAppMode()) throw new SyncConfigError('云同步连接仅可在本地客户端中配置');
  const explicit = serverEnv('BYQX_CONFIG_PATH');
  if (explicit) return path.resolve(explicit);
  const appData = serverEnv('APPDATA');
  if (!appData) throw new SyncConfigError('本地配置目录不可用，请重新打开应用');
  return path.join(appData, 'byqx-blog-desktop', 'config.json');
}
export function validateConnection(value: unknown): string {
  if (typeof value !== 'string') throw new SyncConfigError('连接串必须为文本');
  const text = value.trim();
  if (!text || text.length > 8192 || /[\u0000-\u001f\u007f]/.test(text)) throw new SyncConfigError('请输入有效的 PostgreSQL 连接串');
  try {
    const url = new URL(text);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw Error();
  } catch { throw new SyncConfigError('请填写 PostgreSQL 连接串，不是 https 网站地址'); }
  return text;
}
export function mergeConnections(input: Record<string, unknown>): CloudConnections {
  const current = cloudConnections();
  const primaryUrl = input.primaryUrl === undefined || input.primaryUrl === '' ? current.primaryUrl : validateConnection(input.primaryUrl);
  const fallbackUrl = input.clearFallback === true ? '' : input.fallbackUrl === undefined || input.fallbackUrl === '' ? current.fallbackUrl : validateConnection(input.fallbackUrl);
  if (!primaryUrl) throw new SyncConfigError('请先填写主库连接串，或导入已有设备的同步配置');
  validateConnection(primaryUrl);
  if (fallbackUrl) validateConnection(fallbackUrl);
  return { primaryUrl, fallbackUrl };
}
export async function saveCloudConnections(input: Record<string, unknown>) {
  if (saving) throw new SyncConfigError('配置正在保存，请稍后再试');
  const connections = mergeConnections(input);
  const file = configPath();
  const temp = file + '.' + randomUUID() + '.tmp';
  saving = true;
  try {
    const config: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('invalid config');
    const next = { ...config, SYNC_DATABASE_URL: connections.primaryUrl, SYNC_DATABASE_URL_FALLBACK: connections.fallbackUrl };
    await fs.writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
    process.env.SYNC_DATABASE_URL = connections.primaryUrl;
    process.env.SYNC_DATABASE_URL_FALLBACK = connections.fallbackUrl;
    return connectionSummary();
  } catch (error) {
    if (error instanceof SyncConfigError) throw error;
    throw new SyncConfigError('无法保存本地配置，原配置未改动，请检查设备存储后重试');
  } finally { saving = false; await fs.unlink(temp).catch(() => {}); }
}
async function probe(url: string) {
  const startedAt = Date.now();
  const sql = postgres(url, { max: 1, connect_timeout: 5, idle_timeout: 1, max_lifetime: 10 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([sql.unsafe('SELECT 1'), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), 8000); })]);
    return { ok: true, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message === 'timeout'
        ? '连接超时（8 秒），请检查网络和数据库服务状态'
        : '连接失败，请检查连接串、网络和数据库服务状态',
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
    // Closing a client with a stalled query must not hold the HTTP response open.
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      sql.end({ timeout: 1 }).catch(() => {}),
      new Promise<void>(resolve => { closeTimer = setTimeout(resolve, 1500); }),
    ]);
    if (closeTimer) clearTimeout(closeTimer);
  }
}
export async function testCloudConnections(input: Record<string, unknown>) {
  const connections = mergeConnections(input);
  const [primary, fallback] = await Promise.all([probe(connections.primaryUrl), connections.fallbackUrl ? probe(connections.fallbackUrl) : Promise.resolve(null)]);
  return { primary, fallback, ok: primary.ok && (!fallback || fallback.ok) };
}
function transferPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new SyncConfigError('配置文件口令须为 8–256 个字符');
  return password;
}
function transferKey(password: unknown, salt: Buffer) {
  return scryptSync(transferPassword(password), salt, 32);
}
export function encryptConnections(connections: CloudConnections, password: unknown) {
  validateConnection(connections.primaryUrl);
  if (connections.fallbackUrl) validateConnection(connections.fallbackUrl);
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', transferKey(password, salt), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(connections), 'utf8'), cipher.final()]);
  return { format: 'byqx-sync-v1', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}
export function decryptConnections(envelope: unknown, password: unknown): CloudConnections {
  transferPassword(password);
  try {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw Error();
    const e = envelope as Record<string, unknown>;
    if (e.format !== 'byqx-sync-v1' || ['salt', 'iv', 'tag', 'data'].some(key => typeof e[key] !== 'string' || String(e[key]).length > 32768)) throw Error();
    const salt = Buffer.from(e.salt as string, 'base64'), iv = Buffer.from(e.iv as string, 'base64'), tag = Buffer.from(e.tag as string, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw Error();
    const decipher = createDecipheriv('aes-256-gcm', transferKey(password, salt), iv); decipher.setAuthTag(tag);
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data as string, 'base64')), decipher.final()]).toString('utf8'));
    return { primaryUrl: validateConnection(data.primaryUrl), fallbackUrl: data.fallbackUrl ? validateConnection(data.fallbackUrl) : '' };
  } catch { throw new SyncConfigError('配置文件或口令不正确，原配置未改动'); }
}
