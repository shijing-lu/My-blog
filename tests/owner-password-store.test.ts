import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as tables from '../db/schema.sqlite';

/**
 * 站主口令存储的集成测试：用真实内存 SQLite 跑 settings 表，
 * 验证「改过口令后只认新口令」「环境变量回落」「指纹随口令变化」。
 */
const handles = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../db', () => ({
  get db() {
    return handles.db;
  },
  getPrimaryDb: () => handles.db,
  dbWrite: async (fn: (database: unknown) => unknown) => fn(handles.db),
}));

const {
  getOwnerPasswordRecord,
  hasCustomOwnerPassword,
  ownerPasswordFingerprint,
  ownerPasswordStatus,
  saveOwnerPassword,
  verifyOwnerPassword,
} = await import('../src/lib/owner-password');

let database: BetterSqlite3.Database;
const envPassword = 'env-owner-password';
const newPassword = 'brand-new-owner-password';

beforeEach(() => {
  vi.stubEnv('TOP_ADMIN_PASSWORD', envPassword);
  vi.stubEnv('ADMIN_PASSWORD', 'legacy-admin-password');
  database = new BetterSqlite3(':memory:');
  // schema.sqlite 的 settings 是 timestampMs（整数毫秒），与 PG 方言的迁移 DDL 不同，
  // 这里直接按 SQLite 方言建表，别复用 deployment-migration 的 `timestamp with time zone`。
  database.exec(
    'CREATE TABLE "settings" ("key" text PRIMARY KEY NOT NULL, "value" text NOT NULL, "updated_at" integer NOT NULL)',
  );
  handles.db = drizzle(database, { schema: tables });
});
afterEach(() => {
  database.close();
  vi.unstubAllEnvs();
});

describe('站主口令存储', () => {
  it('没有自定义记录时回落到环境变量口令', async () => {
    expect(await hasCustomOwnerPassword()).toBe(false);
    expect(await getOwnerPasswordRecord()).toBeNull();
    expect(await verifyOwnerPassword(envPassword)).toBe(true);
    expect(await verifyOwnerPassword('legacy-admin-password')).toBe(false);
    expect(await verifyOwnerPassword('')).toBe(false);
    expect(await ownerPasswordStatus()).toMatchObject({ custom: false, source: 'env-top' });
  });

  it('保存后只认新口令，环境变量口令立即失效', async () => {
    await saveOwnerPassword(newPassword);
    expect(await hasCustomOwnerPassword()).toBe(true);
    expect(await verifyOwnerPassword(newPassword)).toBe(true);
    expect(await verifyOwnerPassword(envPassword)).toBe(false);
    const status = await ownerPasswordStatus();
    expect(status).toMatchObject({ custom: true, source: 'custom' });
    expect(status.updatedAt).toBeTruthy();
  });

  it('重复保存会覆盖同一行而不是追加记录', async () => {
    await saveOwnerPassword('first-new-password');
    await saveOwnerPassword('second-new-password');
    const rows = database.prepare('SELECT * FROM settings').all();
    expect(rows).toHaveLength(1);
    expect(await verifyOwnerPassword('first-new-password')).toBe(false);
    expect(await verifyOwnerPassword('second-new-password')).toBe(true);
  });

  it('记录只存摘要，不含明文', async () => {
    await saveOwnerPassword(newPassword);
    const rows = JSON.stringify(database.prepare('SELECT * FROM settings').all());
    expect(rows).not.toContain(newPassword);
    expect(rows).toContain('scrypt');
  });

  it('口令指纹随口令变化（移动端据此让旧会话失效）', async () => {
    const before = await ownerPasswordFingerprint();
    await saveOwnerPassword(newPassword);
    const after = await ownerPasswordFingerprint();
    expect(before).not.toBe(after);
    expect(await ownerPasswordFingerprint()).toBe(after);
  });

  it('设置表不可用时按「未自定义」处理，不抛错', async () => {
    database.exec('DROP TABLE settings');
    expect(await getOwnerPasswordRecord()).toBeNull();
    expect(await hasCustomOwnerPassword()).toBe(false);
    expect(await verifyOwnerPassword(envPassword)).toBe(true);
  });
});
