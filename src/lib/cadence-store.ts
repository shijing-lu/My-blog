import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import postgres from "postgres";
import { readDatabaseUrl, readFallbackDatabaseUrl } from "../../db/dialect";
import { serverEnv } from "./env";
import {
  canonicalContent,
  recordKey,
  validateCadenceSnapshot,
  type RemoteRecord,
  type SyncChange,
  type SyncResult,
} from "@/cadence/sync/protocol";

export const CADENCE_DDL = `CREATE TABLE IF NOT EXISTS cadence_records (id text PRIMARY KEY NOT NULL, kind text NOT NULL, record_id text NOT NULL, payload text, revision text NOT NULL, updated_at text NOT NULL)`;
interface StoredRow {
  id: string;
  kind: RemoteRecord["table"];
  record_id: string;
  payload: string | null;
  revision: string;
}
const fromRow = (r: StoredRow): RemoteRecord => ({
  key: r.id,
  table: r.kind,
  recordId: r.record_id,
  payload: r.payload === null ? null : JSON.parse(r.payload),
  revision: r.revision,
});
export interface CadenceStore {
  list(): Promise<RemoteRecord[]>;
  sync(changes: SyncChange[]): Promise<SyncResult>;
  close(): Promise<void>;
}

/** 服务端锁内规划批次。同一 payload 重试时返回原 revision，实现失去响应后的幂等。 */
export function planCadenceChanges(
  existing: RemoteRecord[],
  changes: SyncChange[],
): SyncResult {
  const current = new Map(existing.map((r) => [r.key, r]));
  const records: RemoteRecord[] = [],
    conflicts: RemoteRecord[] = [];
  for (const change of changes) {
    const key = recordKey(change.table, change.recordId),
      old = current.get(key);
    if (
      old &&
      canonicalContent(old.payload) === canonicalContent(change.payload)
    ) {
      records.push(old);
      continue;
    }
    if ((old?.revision ?? null) !== change.baseRevision) {
      conflicts.push(
        old ?? {
          key,
          table: change.table,
          recordId: change.recordId,
          payload: null,
          revision: "",
        },
      );
      continue;
    }
    const next: RemoteRecord = {
      key,
      table: change.table,
      recordId: change.recordId,
      payload: change.payload,
      revision: randomUUID(),
    };
    current.set(key, next);
    records.push(next);
  }
  validateCadenceSnapshot([...current.values()]);
  return { records, conflicts };
}

/** 同步不能绕过时段重叠、单计时器、唯一日计划/复盘格等业务约束。 */
const requireHere = createRequire(import.meta.url);
export function createSqliteCadenceStore(file: string): CadenceStore {
  const ctor = requireHere("better-sqlite3") as typeof Database;
  const client = new ctor(file);
  client.pragma("busy_timeout = 5000");
  client.exec(CADENCE_DDL);
  const read = () =>
    (client.prepare("SELECT * FROM cadence_records").all() as StoredRow[]).map(
      fromRow,
    );
  const write = client.prepare(
    "INSERT INTO cadence_records(id,kind,record_id,payload,revision,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, revision=excluded.revision, updated_at=excluded.updated_at",
  );
  const transaction = client.transaction((changes: SyncChange[]) => {
    const result = planCadenceChanges(read(), changes);
    for (const r of result.records)
      write.run(
        r.key,
        r.table,
        r.recordId,
        r.payload === null ? null : JSON.stringify(r.payload),
        r.revision,
        new Date().toISOString(),
      );
    return result;
  });
  return {
    list: async () => read(),
    sync: async (changes) => transaction.immediate(changes),
    close: async () => {
      client.close();
    },
  };
}

export function createPgCadenceStore(url: string, fallbackUrl = ''): CadenceStore {
  const clients = [...new Set([url, fallbackUrl].filter(Boolean))]
    .map(connection => postgres(connection, { max: 1, connect_timeout: 5, idle_timeout: 20 }));
  let active = 0;
  async function useAvailable<T>(operation: (client: ReturnType<typeof postgres>) => Promise<T>): Promise<{ result: T; index: number }> {
    let lastError: unknown;
    for (const index of [active, ...clients.map((_, i) => i).filter(i => i !== active)]) {
      try {
        const result = await operation(clients[index]!);
        active = index;
        return { result, index };
      } catch (error) {
        lastError = error;
        // Business validation errors cannot be bypassed by trying a different DB.
        const code = (error as { code?: string }).code || '';
        if (!/^(ECONN|ETIMEDOUT|ENOTFOUND|EHOST|08|57P0|CONNECTION_)/.test(code)) throw error;
      }
    }
    throw lastError;
  }
  return {
    list: async () => (await useAvailable(async client =>
      (await client<StoredRow[]>`SELECT * FROM cadence_records`).map(fromRow))).result,
    sync: async (changes) => {
      const stamp = new Date().toISOString();
      const { result, index } = await useAvailable(async client =>
        client.begin(async (tx) => {
        // 单站主事务锁同时保护日程重叠与单活动 Session，跨请求/进程有效。
        await tx`SELECT pg_advisory_xact_lock(77321041)`;
        const result = planCadenceChanges(
          (await tx<StoredRow[]>`SELECT * FROM cadence_records`).map(fromRow),
          changes,
        );
        for (const r of result.records)
          await tx`INSERT INTO cadence_records(id,kind,record_id,payload,revision,updated_at) VALUES (${r.key},${r.table},${r.recordId},${r.payload === null ? null : JSON.stringify(r.payload)},${r.revision},${stamp}) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload, revision=EXCLUDED.revision, updated_at=EXCLUDED.updated_at`;
        return result;
        }) as Promise<SyncResult>);
      // Mirror the exact accepted CAS revisions; regenerating revisions on the
      // second endpoint would cause false conflicts immediately after failover.
      for (let replica = 0; replica < clients.length; replica++) {
        if (replica === index) continue;
        try {
          const conflicts = await clients[replica]!.begin(async tx => {
            await tx`SELECT pg_advisory_xact_lock(77321041)`;
            const existing = new Map((await tx<StoredRow[]>`SELECT * FROM cadence_records`).map(row => [row.id, fromRow(row)]));
            const preserved: RemoteRecord[] = [];
            for (const record of result.records) {
              const previous = existing.get(record.key);
              const change = changes.find(item => recordKey(item.table, item.recordId) === record.key);
              if (previous && previous.revision !== record.revision && previous.revision !== change?.baseRevision && canonicalContent(previous.payload) !== canonicalContent(record.payload)) {
                preserved.push(previous);
                continue;
              }
              await tx`INSERT INTO cadence_records(id,kind,record_id,payload,revision,updated_at) VALUES (${record.key},${record.table},${record.recordId},${record.payload === null ? null : JSON.stringify(record.payload)},${record.revision},${stamp}) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload, revision=EXCLUDED.revision, updated_at=EXCLUDED.updated_at`;
            }
            return preserved;
          });
          result.conflicts.push(...conflicts);
        } catch (error) {
          console.error('[cadence] replica write failed; committed source records remain available', (error as Error).message);
        }
      }
      return result;
    },
    close: async () => {
      await Promise.all(clients.map(client => client.end()));
    },
  };
}

let store: CadenceStore | undefined;
export function cadenceStore(): CadenceStore {
  if (store) return store;
  // Electron 本地网站的 API 直接使用配置的同步云库；断网时客户端继续使用 IndexedDB。
  const url =
    (serverEnv("DESKTOP_MODE") === "1" && serverEnv("SYNC_DATABASE_URL")) ||
    readDatabaseUrl();
  store = /^postgres(ql)?:\/\//.test(url)
    ? createPgCadenceStore(url, serverEnv("DESKTOP_MODE") === "1" ? serverEnv("SYNC_DATABASE_URL_FALLBACK") : readFallbackDatabaseUrl())
    : createSqliteCadenceStore(url.replace(/^file:/, ""));
  return store;
}
