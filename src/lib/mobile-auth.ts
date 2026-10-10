import { and, eq, isNull, or } from 'drizzle-orm';
import { getPrimaryDb } from '../../db';
import { mobileSessions } from '../../db/schema.sqlite';
import { checkTopPassword, topAdminPassword } from './admin-auth';
import { checkPassword } from './auth';
import { serverEnv } from './env';
import { createMobileAuth, MobileAuthError, type MobileSessionStore } from './mobile-auth-core';

const store: MobileSessionStore = {
  async insert(row) { await getPrimaryDb().insert(mobileSessions).values(row); },
  async byAccess(hash) { return (await getPrimaryDb().select().from(mobileSessions).where(eq(mobileSessions.accessHash, hash)).limit(1))[0] ?? null; },
  async byRefresh(hash) { return (await getPrimaryDb().select().from(mobileSessions).where(or(eq(mobileSessions.refreshHash, hash), eq(mobileSessions.previousRefreshHash, hash))).limit(1))[0] ?? null; },
  async rotate(id, hash, row) { return (await getPrimaryDb().update(mobileSessions).set(row).where(and(eq(mobileSessions.id, id), eq(mobileSessions.refreshHash, hash), isNull(mobileSessions.revokedAt))).returning({ id: mobileSessions.id })).length === 1; },
  async revoke(id, now) { await getPrimaryDb().update(mobileSessions).set({ revokedAt: now, updatedAt: now }).where(eq(mobileSessions.id, id)); },
};
export const mobileAuth = createMobileAuth(store, {
  password: () => topAdminPassword() || serverEnv('ADMIN_PASSWORD'), secret: () => serverEnv('AUTH_SECRET'),
  checkPassword: value => topAdminPassword() ? checkTopPassword(value) : checkPassword(value),
});
export async function requireMobileOwner(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) throw new MobileAuthError(401, 'reauth_required', '需要站主移动会话');
  return mobileAuth.me(authorization.slice(7));
}
export function mobileJson(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', ...extra } });
}
export function mobileError(error: unknown) {
  return error instanceof MobileAuthError ? mobileJson({ code: error.code, error: error.message }, error.status) :
    mobileJson({ code: 'service_unavailable', error: '服务暂不可用，请稍后重试' }, 503);
}
