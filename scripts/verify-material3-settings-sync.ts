/**
 * Live sync acceptance without accessing the desktop database or real ui_style.
 * Default: inspect the plan and exercise guards; --execute enables the one-key probe.
 * Run: node --import tsx scripts/verify-material3-settings-sync.ts --execute
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import postgres from 'postgres';
import { PgEndpoint } from '../src/sync/adapters/pg-endpoint';
import { SqliteEndpoint, type SqliteLikeDb } from '../src/sync/adapters/sqlite-endpoint';
import type { SyncEndpoint } from '../src/sync/adapters/source';
import type { SyncReport, SyncRow } from '../src/sync/core/types';
import { runSync } from '../src/sync/engine';
import { LocalSyncStore } from '../src/sync/local-store';
import { policyFor } from '../src/sync/tables';

const output = path.resolve('outputs/material3-review');
mkdirSync(output, { recursive: true });
const execute = process.argv.includes('--execute');
const probe = `__material_ui_sync_probe_${randomUUID()}`;
assert.match(probe, /^__material_ui_sync_probe_[0-9a-f-]{36}$/);
assert.notEqual(probe, 'ui_style');
const settingsPolicy = policyFor('settings');
assert(settingsPolicy && settingsPolicy.role === 'lww' && settingsPolicy.changeBy === 'updated_at');
assert.deepEqual(settingsPolicy.pk, ['key']);
const scopedPolicy = {
  ...settingsPolicy,
  excludeWhere: (row: SyncRow) => row.key !== probe || !!settingsPolicy.excludeWhere?.(row),
};

type Audit = { endpoint: string; operation: string; rows: number };
const audit: Audit[] = [];
let permitWrites = true;

function checkTable(table: string): void {
  assert.equal(table, 'settings', 'The probe cannot access another table');
}
function checkPk(pk: string[]): void {
  assert.deepEqual(pk, ['key'], 'Only the settings key primary key is allowed');
}
function checkRow(row: SyncRow): void {
  assert.equal(row.key, probe, 'The probe cannot access another settings key');
  assert.deepEqual(Object.keys(row).sort(), ['key', 'updated_at', 'value'], 'Only the existing settings columns are allowed');
  assert.equal(typeof row.value, 'string');
  const parsed = JSON.parse(row.value as string) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ['defaultStyle']);
  assert(['material3', 'classic'].includes(String(parsed.defaultStyle)));
  const stamp = row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at;
  assert.equal(typeof stamp, 'number');
  assert(Number.isFinite(stamp));
}

/** The delegate's whole-table reader is never used, including in guard self-tests. */
function scopedEndpoint(delegate: SyncEndpoint, readOne: () => Promise<SyncRow[]>): SyncEndpoint {
  const validate = (table: string, rows: SyncRow[], pk: string[]) => {
    assert(permitWrites, 'Probe writes are closed before cleanup');
    checkTable(table); checkPk(pk); rows.forEach(checkRow);
  };
  return {
    name: delegate.name,
    async readRows(table) {
      checkTable(table);
      const rows = await readOne();
      assert(rows.length <= 1, 'The reader must return at most the unique probe');
      rows.forEach(checkRow);
      audit.push({ endpoint: delegate.name, operation: 'read-exact-key', rows: rows.length });
      return rows;
    },
    async upsertRows(table, rows, pk) {
      validate(table, rows, pk);
      audit.push({ endpoint: delegate.name, operation: 'upsert-exact-key', rows: rows.length });
      return delegate.upsertRows(table, rows, pk);
    },
    async updateRows(table, rows, pk) {
      validate(table, rows, pk);
      audit.push({ endpoint: delegate.name, operation: 'update-exact-key', rows: rows.length });
      return delegate.updateRows(table, rows, pk);
    },
    async deleteRows(table, ids, pk) {
      assert(permitWrites, 'Probe writes are closed before cleanup');
      checkTable(table); checkPk(pk);
      ids.forEach(id => assert.equal(id, probe, 'The probe cannot delete another key'));
      audit.push({ endpoint: delegate.name, operation: 'delete-exact-key', rows: ids.length });
      return delegate.deleteRows(table, ids, pk);
    },
    close: () => delegate.close(),
  };
}

async function verifyGuards(): Promise<number> {
  let delegateWrites = 0;
  let readerCalls = 0;
  const delegate: SyncEndpoint = {
    name: 'guard-self-test',
    readRows: async () => { throw Error('Unfiltered reader must never be called'); },
    upsertRows: async (_table, rows) => { delegateWrites++; return rows.length; },
    updateRows: async (_table, rows) => { delegateWrites++; return rows.length; },
    deleteRows: async (_table, ids) => { delegateWrites++; return ids.length; },
    close: async () => {},
  };
  const valid = { key: probe, value: '{"defaultStyle":"material3"}', updated_at: Date.now() };
  const scope = scopedEndpoint(delegate, async () => { readerCalls++; return [valid]; });
  let rejected = 0;
  const rejects = async (run: () => Promise<unknown>) => { await assert.rejects(run); rejected++; };
  await rejects(() => scope.readRows('articles'));
  assert.equal(readerCalls, 0, 'Invalid table is rejected before any database read');
  for (const method of ['upsertRows', 'updateRows'] as const) {
    await rejects(() => scope[method]('articles', [valid], ['key']));
    await rejects(() => scope[method]('settings', [{ ...valid, key: 'ui_style' }], ['key']));
    await rejects(() => scope[method]('settings', [valid], ['id']));
    await rejects(() => scope[method]('settings', [{ ...valid, other: 'forbidden' }], ['key']));
    await rejects(() => scope[method]('settings', [{ ...valid, value: '{"defaultStyle":"inherit"}' }], ['key']));
    await rejects(() => scope[method]('settings', [{ ...valid, value: '{"defaultStyle":"material3","extra":true}' }], ['key']));
    await rejects(() => scope[method]('settings', [{ ...valid, updated_at: NaN }], ['key']));
    await rejects(() => scope[method]('settings', [valid, { ...valid, key: 'ui_style' }], ['key']));
  }
  await rejects(() => scope.deleteRows('settings', ['ui_style'], ['key']));
  await rejects(() => scope.deleteRows('articles', [probe], ['key']));
  await rejects(() => scope.deleteRows('settings', [probe], ['id']));
  await rejects(() => scopedEndpoint(delegate, async () => [{ ...valid, key: 'ui_style' }]).readRows('settings'));
  await rejects(() => scopedEndpoint(delegate, async () => [valid, valid]).readRows('settings'));
  permitWrites = false;
  await rejects(() => scope.upsertRows('settings', [valid], ['key']));
  await rejects(() => scope.updateRows('settings', [valid], ['key']));
  await rejects(() => scope.deleteRows('settings', [probe], ['key']));
  permitWrites = true;
  assert.equal(delegateWrites, 0, 'Every unsafe operation must be rejected before delegation');
  assert.deepEqual(await scope.readRows('settings'), [valid]);
  audit.length = 0;
  return rejected;
}

interface Summary {
  phase: string; ok: boolean; pushed: number; pulled: number;
  deletedRemote: number; deletedLocal: number; conflicts: number;
  mirrorKeys: number; scopedRows: number; timingMs: number;
}
const report = {
  status: execute ? 'running' : 'planned',
  executedAt: new Date().toISOString(),
  probeKey: probe,
  scope: {
    table: 'settings', primaryKey: 'key', values: ['material3', 'classic'],
    cloudReader: 'Parameterized SELECT key,value,updated_at FROM settings WHERE key = probeKey',
    cloudWriter: 'Real PgEndpoint upsertRows/deleteRows with primary and fallback mirror',
    engine: 'Real runSync, LocalSyncStore and SqliteEndpoint; only the registered settings policy',
    actualDesktopDatabaseOpened: false, actualUiStyleAccessed: false,
    userRowsRead: false, cloudMetadataWritten: false,
  },
  guardRejections: 0,
  phases: [] as Summary[],
  endpointChecks: [] as { phase: string; endpoint: string; style: string; timestampMatches: boolean }[],
  fallbackWarnings: [] as string[],
  cloudCleanup: [] as { endpoint: string; absent: boolean; errorCode?: string }[],
  isolatedLocalCleanup: false,
  audit,
  failure: null as null | { phase: string; name: string; code: string },
};

function safeError(error: unknown): { name: string; code: string } {
  // Never retain driver messages, stacks, config, URLs, usernames or passwords.
  const value = error as { name?: unknown; code?: unknown };
  const name = typeof value?.name === 'string' && /^[a-zA-Z]+$/.test(value.name) ? value.name : 'Error';
  const code = typeof value?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(value.code) ? value.code : 'UNSPECIFIED';
  return { name, code };
}

let phase = 'guard-self-test';
let pg: PgEndpoint | null = null;
const clients: { name: string; sql: ReturnType<typeof postgres> }[] = [];
const localDatabases: Database.Database[] = [];
let tempDir: string | null = null;
let cleanupRequired = false;
let failed = false;
try {
  report.guardRejections = await verifyGuards();
  if (!execute) {
    console.log(`MATERIAL_SETTINGS_SYNC_PLAN_OK guards=${report.guardRejections}; add --execute for the isolated one-key live probe`);
  } else {
    phase = 'read-existing-desktop-config';
    assert(process.env.APPDATA, 'APPDATA is required to locate existing desktop config');
    const configPath = path.join(process.env.APPDATA, 'byqx-blog-desktop', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const primaryUrl = config.SYNC_DATABASE_URL;
    const fallbackUrl = config.SYNC_DATABASE_URL_FALLBACK;
    assert.equal(typeof primaryUrl, 'string', 'A configured primary PostgreSQL endpoint is required');
    assert.equal(typeof fallbackUrl, 'string', 'A configured fallback PostgreSQL endpoint is required');
    assert.match(primaryUrl as string, /^postgres(?:ql)?:\/\//);
    assert.match(fallbackUrl as string, /^postgres(?:ql)?:\/\//);
    assert.notEqual(primaryUrl, fallbackUrl, 'Distinct main and fallback endpoints are required');
    for (const [name, url] of [['primary', primaryUrl], ['fallback', fallbackUrl]] as const) {
      clients.push({ name, sql: postgres(url as string, { max: 1, connect_timeout: 10, idle_timeout: 10, max_lifetime: 60, onnotice: () => {} }) });
    }
    phase = 'preflight-unique-probe-absent';
    for (const client of clients) {
      const rows = await client.sql`SELECT key FROM settings WHERE key = ${probe}`;
      assert.equal(rows.length, 0, 'Unique probe must not already exist before any write');
    }
    // Start cleanup ownership only after both endpoints confirm absence.
    cleanupRequired = true;
    pg = new PgEndpoint({
      primaryUrl: primaryUrl as string, fallbackUrl: fallbackUrl as string,
      onFallbackError: () => report.fallbackWarnings.push(`Fallback mirror failure during ${phase}`),
    });
    const cloud = scopedEndpoint(pg, async () => {
      const rows = await clients[0]!.sql`SELECT key, value, updated_at FROM settings WHERE key = ${probe}`;
      return rows as unknown as SyncRow[];
    });
    tempDir = mkdtempSync(path.join(output, 'settings-sync-probe-'));
    const locals = ['local-a', 'local-b'].map(name => {
      const database = new Database(path.join(tempDir!, `${name}.sqlite`));
      localDatabases.push(database);
      database.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
      const handle = drizzle(database) as unknown as SqliteLikeDb;
      const delegate = new SqliteEndpoint(handle, name);
      const local = scopedEndpoint(delegate, async () => database.prepare('SELECT key,value,updated_at FROM settings WHERE key = ?').all(probe) as SyncRow[]);
      return { name, database, local, store: new LocalSyncStore(handle) };
    });
    const sync = async (index: number, label: string, expected: { pushed: number; pulled: number }) => {
      phase = label;
      const env = locals[index]!;
      const result: SyncReport = await runSync({
        local: env.local, cloud, store: env.store, policies: [scopedPolicy],
        tableTimeoutMs: 45_000, totalTimeoutMs: 50_000,
      });
      assert.equal(result.ok, true, 'Single-key real engine run must succeed');
      assert.equal(result.perTable.length, 1);
      const stat = result.perTable[0]!;
      assert.equal(stat.table, 'settings');
      assert.equal(stat.pushed, expected.pushed, 'Real engine push count');
      assert.equal(stat.pulled, expected.pulled, 'Real engine pull count');
      assert.equal(stat.conflicts, 0);
      assert.equal(stat.deletedLocal, 0); assert.equal(stat.deletedRemote, 0);
      const mirror = await env.store.loadMirror('settings');
      assert.deepEqual([...mirror.keys()], [probe], 'Only the unique key may enter local metadata');
      const totalRows = (env.database.prepare('SELECT count(*) AS count FROM settings').get() as { count: number }).count;
      assert.equal(totalRows, 1, 'No user rows are imported to the empty local database');
      report.phases.push({ phase, ok: true, pushed: stat.pushed, pulled: stat.pulled, deletedRemote: 0, deletedLocal: 0, conflicts: 0, mirrorKeys: mirror.size, scopedRows: totalRows, timingMs: stat.timingMs });
      assert.equal(report.fallbackWarnings.length, 0, 'Both primary and fallback writes must succeed');
      console.log(`MATERIAL_SETTINGS_SYNC_ENGINE_OK ${phase} pushed=${stat.pushed} pulled=${stat.pulled}`);
    };
    const stampBase = Date.now();
    for (const [index, defaultStyle] of ['material3', 'classic'].entries()) {
      phase = `seed-${defaultStyle}-local-a`;
      const updatedAt = stampBase + index * 1000;
      const value = JSON.stringify({ defaultStyle });
      await locals[0]!.local.upsertRows('settings', [{ key: probe, value, updated_at: updatedAt }], ['key']);
      await sync(0, `${defaultStyle}-local-a-to-cloud`, { pushed: 1, pulled: 0 });
      phase = `verify-${defaultStyle}-primary-fallback`;
      for (const client of clients) {
        const rows = await client.sql`SELECT key,value,updated_at FROM settings WHERE key = ${probe}`;
        assert.equal(rows.length, 1);
        checkRow(rows[0] as SyncRow);
        assert.deepEqual(JSON.parse(rows[0]!.value), { defaultStyle });
        const stamp = rows[0]!.updated_at;
        assert.equal(stamp instanceof Date ? stamp.getTime() : Number(stamp), updatedAt, 'PostgreSQL timestamp must round-trip to SQLite milliseconds');
        report.endpointChecks.push({ phase, endpoint: client.name, style: defaultStyle, timestampMatches: true });
      }
      await sync(1, `${defaultStyle}-cloud-to-local-b`, { pushed: 0, pulled: 1 });
      const downloaded = locals[1]!.database.prepare('SELECT value,updated_at FROM settings WHERE key = ?').get(probe) as { value: string; updated_at: number };
      assert.deepEqual(JSON.parse(downloaded.value), { defaultStyle });
      assert.equal(downloaded.updated_at, updatedAt);
    }
    await sync(0, 'local-a-idempotent', { pushed: 0, pulled: 0 });
    await sync(1, 'local-b-idempotent', { pushed: 0, pulled: 0 });
    report.status = 'passed';
  }
} catch (error) {
  failed = true;
  report.status = 'failed';
  report.failure = { phase, ...safeError(error) };
  console.error(`MATERIAL_SETTINGS_SYNC_FAILED phase=${phase} code=${report.failure.code}`);
} finally {
  // A timed-out runSync does not cancel pending work. Close its write gate, drain/
  // terminate all writer connections, then clean with independent scoped clients.
  permitWrites = false;
  if (pg) await pg.close();
  if (cleanupRequired) {
    for (const client of clients) {
      try {
        await client.sql`DELETE FROM settings WHERE key = ${probe}`;
        const remaining = await client.sql`SELECT key FROM settings WHERE key = ${probe}`;
        assert.equal(remaining.length, 0, 'Exact-key cloud cleanup must be verified');
        report.cloudCleanup.push({ endpoint: client.name, absent: true });
      } catch (error) {
        failed = true; report.status = 'failed';
        report.cloudCleanup.push({ endpoint: client.name, absent: false, errorCode: safeError(error).code });
      }
    }
  }
  for (const client of clients) await client.sql.end({ timeout: 5 }).catch(() => {});
  for (const database of localDatabases) database.close();
  if (tempDir) {
    // Resolve and verify the final absolute path before recursive removal on Windows.
    const resolvedOutput = realpathSync(output);
    const resolvedTemp = realpathSync(tempDir);
    assert.equal(path.dirname(resolvedTemp), resolvedOutput);
    assert(path.basename(resolvedTemp).startsWith('settings-sync-probe-'));
    rmSync(resolvedTemp, { recursive: true, force: true });
    report.isolatedLocalCleanup = true;
  }
  writeFileSync(path.join(output, execute ? 'settings-sync.json' : 'settings-sync-plan.json'), JSON.stringify(report, null, 2));
}
if (execute && !failed) console.log('MATERIAL_SETTINGS_SYNC_PRIMARY_FALLBACK_ROUNDTRIP_VERIFIED cleanup=2/2');
process.exitCode = failed ? 1 : 0;
