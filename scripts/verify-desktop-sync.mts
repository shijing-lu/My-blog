/** Read-only comparison of the desktop database and its configured cloud endpoints. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import postgres from 'postgres';
import { SYNC_POLICIES } from '../src/sync/tables';
import { rowHash, rowId } from '../src/sync/core/hash';
import type { SyncRow } from '../src/sync/core/types';

const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA!, 'byqx-blog-desktop/config.json'), 'utf8'));
const local = new Database(config.LOCAL_DB_PATH || path.join(process.env.APPDATA!, 'byqx-blog-desktop/blog-local.db'), { readonly: true });
const summary: unknown[] = [];
try {
  for (const [name, url] of [['primary', config.SYNC_DATABASE_URL], ['backup', config.SYNC_DATABASE_URL_FALLBACK || config.SYNC_DATABASE_URL_BACKUP_PRISMA]]) {
    if (!url) { console.log(`${name}: not configured`); continue; }
    const client = postgres(url, { max: 1, connect_timeout: 8, onnotice: () => {} });
    try {
      for (const policy of SYNC_POLICIES.filter(p => p.role !== 'skip' && p.role !== 'local-only')) {
        const ours = (local.prepare(`SELECT * FROM "${policy.table}"`).all() as SyncRow[]).filter(r => !policy.excludeWhere?.(r));
        const theirs = (await client.unsafe(`SELECT * FROM "${policy.table}"`) as unknown as SyncRow[]).filter(r => !policy.excludeWhere?.(r));
        const columns = policy.columns || (local.prepare(`PRAGMA table_info("${policy.table}")`).all() as { name: string }[]).map(column => column.name);
        const remote = new Map(theirs.map(r => [rowId(r, policy.pk), r]));
        let missing = 0, different = 0;
        const differentColumns = new Set<string>();
        for (const row of ours) {
          const other = remote.get(rowId(row, policy.pk));
          if (!other) missing++;
          else if (rowHash(other, columns) !== rowHash(row, columns)) {
            different++;
            for (const column of columns) if (rowHash(other, [column]) !== rowHash(row, [column])) differentColumns.add(column);
          }
        }
        summary.push({ endpoint: name, table: policy.table, localRows: ours.length, cloudRows: theirs.length, missing, different, differentColumns: [...differentColumns] });
      }
    } finally { await client.end({ timeout: 2 }); }
  }
} finally { local.close(); }
fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/desktop-sync-comparison.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
