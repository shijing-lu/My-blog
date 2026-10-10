import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { schema } from '../scripts/deployment-migration.mjs';
import * as tables from '../db/schema.sqlite';

const handles = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../db', () => ({ getPrimaryDb: () => handles.db }));
import { mobileAuth, requireMobileOwner } from '../src/lib/mobile-auth';
import { GET, POST } from '../src/pages/api/mobile/v1/auth/[action]';
import { tokenHash } from '../src/lib/mobile-auth-core';
import { SYNC_POLICIES } from '../src/sync/tables';

let database: BetterSqlite3.Database;
const password = 'synthetic-owner-test-password';
const login = () => mobileAuth.login({ password, deviceId: randomUUID(), deviceName: 'Fixture phone' });
const request = (action: string, body?: unknown, headers: Record<string, string> = {}) => ({
  params: { action }, request: new Request(`http://localhost/api/mobile/v1/auth/${action}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'x-forwarded-for': randomUUID(), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }),
}) as unknown as Parameters<typeof POST>[0];

beforeEach(() => {
  vi.stubEnv('TOP_ADMIN_PASSWORD', password); vi.stubEnv('ADMIN_PASSWORD', 'legacy-test-password');
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-tests-only-32');
  database = new BetterSqlite3(':memory:');
  database.exec(schema.tables.find((table: { name: string }) => table.name === 'mobile_sessions')!.create);
  handles.db = drizzle(database, { schema: tables });
});
afterEach(() => { database.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('owner mobile authentication with actual SQLite CAS', () => {
  it('issues owner credentials and stores only their hashes', async () => {
    const session = await login();
    expect(session.owner).toEqual({ id: 'site-owner', role: 'owner' });
    expect((await mobileAuth.me(session.accessToken!)).sessionId).toBe(session.sessionId);
    const rows = database.prepare('SELECT * FROM mobile_sessions').all();
    expect(JSON.stringify(rows)).not.toContain(session.accessToken!);
    expect(JSON.stringify(rows)).not.toContain(session.refreshToken!);
    expect(JSON.stringify(rows)).not.toContain(password);
    expect(rows[0]).toMatchObject({ access_hash: tokenHash(session.accessToken!) });
  });
  it('accepts only the configured top password when both owner channels exist', async () => {
    await expect(mobileAuth.login({ password: 'legacy-test-password', deviceId: randomUUID(), deviceName: 'test' })).rejects.toMatchObject({ status: 401 });
  });
  it('supports legacy owner password only when the top channel is unconfigured', async () => {
    vi.stubEnv('TOP_ADMIN_PASSWORD', '');
    const session = await mobileAuth.login({ password: 'legacy-test-password', deviceId: randomUUID(), deviceName: 'test' });
    expect(session.owner.role).toBe('owner');
  });
  it('refuses unconfigured auth and malformed device IDs', async () => {
    await expect(mobileAuth.login({ password, deviceId: 'bad', deviceName: 'test' })).rejects.toMatchObject({ status: 400 });
    vi.stubEnv('AUTH_SECRET', '');
    await expect(login()).rejects.toMatchObject({ status: 503 });
  });
  it('rotates tokens and invalidates the previous access token', async () => {
    const first = await login(), requestId = randomUUID();
    const next = await mobileAuth.refresh({ refreshToken: first.refreshToken, requestId });
    expect(next.accessToken).not.toBe(first.accessToken);
    await expect(mobileAuth.me(first.accessToken!)).rejects.toMatchObject({ status: 401 });
    await expect(mobileAuth.me(next.accessToken!)).resolves.toMatchObject({ sessionId: first.sessionId });
  });
  it('recovers a lost refresh response with the same request ID', async () => {
    const first = await login(), requestId = randomUUID();
    const next = await mobileAuth.refresh({ refreshToken: first.refreshToken, requestId });
    const retry = await mobileAuth.refresh({ refreshToken: first.refreshToken, requestId });
    expect(retry.accessToken).toBe(next.accessToken); expect(retry.refreshToken).toBe(next.refreshToken);
    await expect(mobileAuth.refresh({ refreshToken: first.refreshToken, requestId: randomUUID() })).rejects.toMatchObject({ status: 401 });
  });
  it('allows one CAS winner for concurrent different refresh requests', async () => {
    const first = await login();
    const results = await Promise.allSettled([1, 2].map(() => mobileAuth.refresh({ refreshToken: first.refreshToken, requestId: randomUUID() })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('revokes both tokens, rejects refresh retries, and supports repeat revocation', async () => {
    const first = await login(), requestId = randomUUID();
    const next = await mobileAuth.refresh({ refreshToken: first.refreshToken, requestId });
    await mobileAuth.revoke(next.refreshToken!); await mobileAuth.revoke(next.refreshToken!);
    await expect(mobileAuth.me(next.accessToken!)).rejects.toMatchObject({ status: 401 });
    await expect(mobileAuth.refresh({ refreshToken: first.refreshToken, requestId })).rejects.toMatchObject({ status: 401 });
  });
  it('invalidates sessions after the owner password changes', async () => {
    const first = await login(); vi.stubEnv('TOP_ADMIN_PASSWORD', 'new-synthetic-password');
    await expect(mobileAuth.me(first.accessToken!)).rejects.toMatchObject({ status: 401 });
    await expect(mobileAuth.refresh({ refreshToken: first.refreshToken, requestId: randomUUID() })).rejects.toMatchObject({ status: 401 });
  });
  it('expires access at 15 minutes and refresh at its deadline', async () => {
    vi.useFakeTimers(); const first = await login();
    vi.setSystemTime(first.accessExpiresAt);
    await expect(mobileAuth.me(first.accessToken!)).rejects.toMatchObject({ status: 401 });
    await expect(mobileAuth.refresh({ refreshToken: first.refreshToken, requestId: randomUUID() })).resolves.toBeDefined();
    vi.setSystemTime(first.refreshExpiresAt + 90 * 86400_000);
    await expect(mobileAuth.refresh({ refreshToken: first.refreshToken, requestId: randomUUID() })).rejects.toMatchObject({ status: 401 });
  });
  it('never accepts Web cookies, refresh tokens or unsigned role claims as access identity', async () => {
    const first = await login();
    await expect(requireMobileOwner(new Request('http://localhost', { headers: { Cookie: 'top_admin_session=anything; user_session=role-top' } }))).rejects.toMatchObject({ status: 401 });
    await expect(mobileAuth.me(first.refreshToken!)).rejects.toMatchObject({ status: 401 });
    await expect(mobileAuth.me('owner')) .rejects.toMatchObject({ status: 401 });
    expect(SYNC_POLICIES.find(p => p.table === 'mobile_sessions')?.role).toBe('skip');
  });
  it('returns private no-store for info, successful auth, and invalid JSON', async () => {
    const info = await GET(request('info')); expect(info.status).toBe(200);
    const bad = await POST(request('login', '{')); expect(bad.status).toBe(400);
    const bound = await POST(request('login', { password, deviceId: randomUUID(), deviceName: 'phone' })); expect(bound.status).toBe(200);
    const denied = await GET(request('me')); expect(denied.status).toBe(401);
    for (const response of [info, bad, bound, denied]) expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
