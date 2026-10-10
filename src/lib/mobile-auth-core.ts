import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

export interface MobileSessionRow {
  id: string; deviceId: string; deviceName: string; credentialVersion: string;
  accessHash: string; refreshHash: string; previousRefreshHash: string | null; refreshRequestId: string | null;
  accessExpiresAt: string; refreshExpiresAt: string; createdAt: string; updatedAt: string; revokedAt: string | null;
}
export interface MobileSessionStore {
  insert(row: MobileSessionRow): Promise<void>;
  byAccess(hash: string): Promise<MobileSessionRow | null>;
  byRefresh(hash: string): Promise<MobileSessionRow | null>;
  rotate(id: string, expectedHash: string, row: MobileSessionRow): Promise<boolean>;
  revoke(id: string, now: string): Promise<void>;
}
export class MobileAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const ACCESS_TTL = 15 * 60_000, REFRESH_TTL = 30 * 86400_000, MAX_SESSION = 90 * 86400_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const validToken = (token: string, type: 'a' | 'r') => new RegExp(`^mb1${type}_[A-Za-z0-9_-]{43}$`).test(token);
const unauthorized = () => new MobileAuthError(401, 'reauth_required', '会话已失效，请重新输入站主口令');

export function createMobileAuth(store: MobileSessionStore, config: {
  password: () => string; secret: () => string; checkPassword: (value: string) => boolean; now?: () => number;
}) {
  const now = config.now ?? (() => Date.now());
  function version() {
    if (!config.password() || !config.secret()) throw new MobileAuthError(503, 'auth_unconfigured', '服务端尚未配置站主认证');
    return createHmac('sha256', config.secret()).update(`mobile-owner-v1:${config.password()}`).digest('hex');
  }
  const serverId = () => createHmac('sha256', config.secret()).update('mobile-server-v1').digest('hex');
  function active(row: MobileSessionRow | null): row is MobileSessionRow {
    return !!row && !row.revokedAt && row.credentialVersion === version() && Date.parse(row.refreshExpiresAt) > now();
  }
  function envelope(row: MobileSessionRow, accessToken?: string, refreshToken?: string) {
    return { protocolVersion: 1, serverId: serverId(), sessionId: row.id, owner: { id: 'site-owner', role: 'owner' },
      accessExpiresAt: Date.parse(row.accessExpiresAt), refreshExpiresAt: Date.parse(row.refreshExpiresAt),
      serverTime: now(), ...(accessToken ? { accessToken, refreshToken } : {}) };
  }
  function rotatedToken(id: string, requestId: string, type: 'a' | 'r') {
    return `mb1${type}_` + createHmac('sha256', config.secret()).update(`mobile-rotate-v1:${id}:${requestId}:${type}`).digest('base64url');
  }
  function retry(row: MobileSessionRow, hash: string, requestId: string) {
    if (!active(row) || row.previousRefreshHash !== hash || row.refreshRequestId !== requestId) throw unauthorized();
    const access = rotatedToken(row.id, requestId, 'a'), refresh = rotatedToken(row.id, requestId, 'r');
    if (tokenHash(access) !== row.accessHash || tokenHash(refresh) !== row.refreshHash) throw unauthorized();
    return envelope(row, access, refresh);
  }
  return {
    info() { return { protocolVersion: 1, appName: '白衣卿相', ownerLoginConfigured: !!config.password() && !!config.secret() }; },
    async login(input: { password?: unknown; deviceId?: unknown; deviceName?: unknown }) {
      version();
      if (typeof input.password !== 'string' || !input.password || input.password.length > 1024 ||
          typeof input.deviceId !== 'string' || !uuid.test(input.deviceId) ||
          typeof input.deviceName !== 'string' || !input.deviceName.trim() || input.deviceName.length > 80) {
        throw new MobileAuthError(400, 'invalid_input', '请提供站主口令与设备信息');
      }
      if (!config.checkPassword(input.password)) throw new MobileAuthError(401, 'wrong_password', '站主口令错误');
      const accessToken = 'mb1a_' + randomBytes(32).toString('base64url'), refreshToken = 'mb1r_' + randomBytes(32).toString('base64url');
      const time = now(), stamp = new Date(time).toISOString();
      const row: MobileSessionRow = { id: randomUUID(), deviceId: input.deviceId, deviceName: input.deviceName.trim(), credentialVersion: version(),
        accessHash: tokenHash(accessToken), refreshHash: tokenHash(refreshToken), previousRefreshHash: null, refreshRequestId: null,
        accessExpiresAt: new Date(time + ACCESS_TTL).toISOString(), refreshExpiresAt: new Date(time + REFRESH_TTL).toISOString(),
        createdAt: stamp, updatedAt: stamp, revokedAt: null };
      await store.insert(row);
      return envelope(row, accessToken, refreshToken);
    },
    async me(token: string) {
      if (!validToken(token, 'a')) throw unauthorized();
      const row = await store.byAccess(tokenHash(token));
      if (!active(row) || Date.parse(row.accessExpiresAt) <= now()) throw unauthorized();
      return envelope(row);
    },
    async refresh(input: { refreshToken?: unknown; requestId?: unknown }) {
      if (typeof input.refreshToken !== 'string' || !validToken(input.refreshToken, 'r') ||
          typeof input.requestId !== 'string' || !uuid.test(input.requestId)) throw unauthorized();
      const hash = tokenHash(input.refreshToken), row = await store.byRefresh(hash);
      if (!active(row)) throw unauthorized();
      if (row.refreshHash !== hash) return retry(row, hash, input.requestId);
      const access = rotatedToken(row.id, input.requestId, 'a'), refresh = rotatedToken(row.id, input.requestId, 'r');
      const time = now();
      const next: MobileSessionRow = { ...row, accessHash: tokenHash(access), refreshHash: tokenHash(refresh),
        previousRefreshHash: hash, refreshRequestId: input.requestId, updatedAt: new Date(time).toISOString(),
        accessExpiresAt: new Date(time + ACCESS_TTL).toISOString(),
        refreshExpiresAt: new Date(Math.min(time + REFRESH_TTL, Date.parse(row.createdAt) + MAX_SESSION)).toISOString() };
      if (!await store.rotate(row.id, hash, next)) {
        const concurrent = await store.byRefresh(hash);
        if (!concurrent) throw unauthorized();
        return retry(concurrent, hash, input.requestId);
      }
      return envelope(next, access, refresh);
    },
    async revoke(refreshToken: string) {
      if (!validToken(refreshToken, 'r')) throw unauthorized();
      const row = await store.byRefresh(tokenHash(refreshToken));
      if (!row || row.credentialVersion !== version()) throw unauthorized();
      await store.revoke(row.id, new Date(now()).toISOString());
      return { ok: true };
    },
  };
}
