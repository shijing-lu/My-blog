/** Backfill the configured legacy backup from the current primary, retaining every differing copy. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import postgres from 'postgres';
import { isTable } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema.pg';
import { PgEndpoint } from '../src/sync/adapters/pg-endpoint';
import { SYNC_POLICIES } from '../src/sync/tables';
import { rowHash, rowId } from '../src/sync/core/hash';

const apply = process.argv.includes('--apply');
const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA!, 'byqx-blog-desktop/config.json'), 'utf8'));
const fallback = config.SYNC_DATABASE_URL_FALLBACK || config.SYNC_DATABASE_URL_BACKUP_PRISMA;
if (!fallback || !config.SYNC_DATABASE_URL || fallback === config.SYNC_DATABASE_URL) throw new Error('Two distinct cloud endpoints are required');
const primary = new PgEndpoint({ primaryUrl: config.SYNC_DATABASE_URL });
const backup = new PgEndpoint({ primaryUrl: fallback });
const backupSql = postgres(fallback, { max: 1, connect_timeout: 8 });
const uniqueKeys = new Map(Object.values(schema).filter(isTable).map(table => {
  const config = getTableConfig(table);
  return [config.name, [
    ...config.columns.filter(column => column.isUnique).map(column => [column.name]),
    ...config.uniqueConstraints.map(constraint => constraint.columns.map(column => column.name)),
  ]];
}));
const local = new Database(config.LOCAL_DB_PATH || path.join(process.env.APPDATA!, 'byqx-blog-desktop/blog-local.db'));
const snapshotDir = path.join('outputs/cloud-before-repair', new Date().toISOString().replaceAll(':', '-'));
fs.mkdirSync(snapshotDir, { recursive: true });
const retain = local.prepare('INSERT INTO sync_conflicts (id, "table", row_id, local_json, remote_json, winner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
const summary = [];
try {
  for (const policy of SYNC_POLICIES.filter(p => p.role !== 'skip' && p.role !== 'local-only')) {
    console.log(`Checking ${policy.table}`);
    const source = (await primary.readRows(policy.table)).filter(r => !policy.excludeWhere?.(r));
    const target = (await backup.readRows(policy.table)).filter(r => !policy.excludeWhere?.(r));
    const byId = new Map(target.map(row => [rowId(row, policy.pk), row]));
    const changed = source.filter(row => {
      const previous = byId.get(rowId(row, policy.pk));
      const columns = policy.columns || Object.keys(row);
      return !previous || rowHash(previous, columns) !== rowHash(row, columns);
    });
    // Older replicas can assign a different UUID to the same date/GitHub identity.
    // Retain that version, then align its primary key with the canonical primary.
    const collisions = changed.flatMap(row => {
      if (byId.has(rowId(row, policy.pk))) return [];
      const previous = target.find(old => (uniqueKeys.get(policy.table) || []).some(columns =>
        columns.every(column => row[column] != null) && rowHash(old, columns) === rowHash(row, columns),
      ));
      return previous ? [{ row, previous }] : [];
    });
    if (apply && changed.length) {
      // Snapshot all backup rows before any overwrite; no deletion of historical extras.
      fs.writeFileSync(path.join(snapshotDir, policy.table + '.json'), JSON.stringify(target));
      local.transaction(() => {
        for (const row of changed) {
          const id = rowId(row, policy.pk), previous = byId.get(id) || collisions.find(item => item.row === row)?.previous;
          if (previous) retain.run(randomUUID(), policy.table, id, JSON.stringify(row), JSON.stringify(previous), 'local', Date.now());
        }
      })();
      if (collisions.length) await backupSql.begin(async tx => {
        for (const { row, previous } of collisions) {
          const set = policy.pk.map((column, i) => `"${column}" = $${i + 1}`).join(', ');
          const where = policy.pk.map((column, i) => `"${column}" = $${policy.pk.length + i + 1}`).join(' AND ');
          await tx.unsafe(`UPDATE "${policy.table}" SET ${set} WHERE ${where}`, [...policy.pk.map(column => row[column]), ...policy.pk.map(column => previous[column])] as Parameters<typeof tx.unsafe>[1]);
        }
      });
      await backup.upsertRows(policy.table, changed, policy.pk);
    }
    summary.push({ table: policy.table, rows: changed.length, preservedCopies: changed.filter(row => byId.has(rowId(row, policy.pk))).length + collisions.length });
    console.log(`${apply ? 'Repaired' : 'Planned'} ${policy.table}: ${changed.length}`);
  }
} finally {
  local.close();
  await Promise.all([primary.close(), backup.close()]);
  await backupSql.end({ timeout: 5 });
}
fs.writeFileSync('outputs/desktop-backup-repair.json', JSON.stringify({ apply, summary }, null, 2));
console.log('BACKUP_REPAIR_OK');
