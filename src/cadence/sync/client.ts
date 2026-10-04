import Dexie from "dexie";
import { create } from "zustand";
import { db } from "@/cadence/data/db/database";
import {
  SYNC_TABLES,
  SYNC_VERSION,
  canonicalContent,
  decideMerge,
  payloadId,
  recordKey,
  validateCadenceSnapshot,
  type EntityPayload,
  type RemoteRecord,
  type SyncChange,
  type SyncResult,
} from "./protocol";

export interface ConflictCopy {
  key: string;
  base: RemoteRecord | null;
  local: EntityPayload | null;
  remote: RemoteRecord;
  detectedAt: number;
  resolved?: boolean;
  history?: RemoteRecord[];
}
interface SyncStatus {
  running: boolean;
  enabled: boolean;
  error: string;
  lastSync: number | null;
  pending: number;
}
export const useSyncStatus = create<SyncStatus>(() => ({
  running: false,
  enabled: false,
  error: "",
  lastSync: null,
  pending: 0,
}));
const bases = db.table<RemoteRecord, string>("_syncBase");
export const conflicts = db.table<ConflictCopy, string>("_syncConflicts");
const pending = db.table<
  { id: string; value?: unknown; changes?: SyncChange[] },
  string
>("_syncPending");
let active: Promise<void> | null = null;
let dirtyTimer: ReturnType<typeof setTimeout> | undefined;

async function request<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const response = await fetch("/api/cadence/sync", {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `同步请求失败（${response.status}）`);
  return data as T;
}
export async function remoteSnapshot(): Promise<RemoteRecord[]> {
  const data = await request<{
    schemaVersion: number;
    records: RemoteRecord[];
  }>("GET");
  if (data.schemaVersion !== SYNC_VERSION)
    throw new Error("同步协议版本不一致，请更新应用");
  return data.records;
}
async function localSnapshot(): Promise<Map<string, EntityPayload>> {
  return db.transaction("r", SYNC_TABLES, async () => {
    const map = new Map<string, EntityPayload>();
    for (const table of SYNC_TABLES)
      for (const p of await db.table<EntityPayload>(table).toArray())
        map.set(recordKey(table, payloadId(table, p)), p);
    return map;
  });
}
export async function syncPreview(): Promise<{
  local: number;
  remote: number;
}> {
  const [local, remote] = await Promise.all([
    localSnapshot(),
    remoteSnapshot(),
  ]);
  return {
    local: local.size,
    remote: remote.filter((r) => r.payload !== null).length,
  };
}
async function rememberConflict(
  record: RemoteRecord,
  local: EntityPayload | null,
  base: RemoteRecord | null,
): Promise<void> {
  const previous = await conflicts.get(record.key);
  await conflicts.put({
    key: record.key,
    local,
    base,
    remote: record,
    detectedAt: Date.now(),
    history: previous
      ? [
          ...(previous.history ?? []),
          previous.remote,
          {
            ...previous.remote,
            payload: previous.local,
            revision: `local:${previous.detectedAt}`,
          },
        ]
      : [],
  });
}
async function currentPayload(
  r: Pick<RemoteRecord, "table" | "recordId">,
): Promise<EntityPayload | null> {
  return (await db.table<EntityPayload>(r.table).get(r.recordId)) ?? null;
}
async function writePayload(record: RemoteRecord): Promise<void> {
  if (record.payload === null)
    await db.table(record.table).delete(record.recordId);
  else await db.table(record.table).put(record.payload);
}

/** 网络返回时再比较本地，不能覆盖在请求飞行期间产生的新编辑。 */
async function acknowledge(
  record: RemoteRecord,
  sent: EntityPayload | null,
): Promise<void> {
  await db.transaction("rw", [db.table(record.table), bases], async () => {
    const current = await currentPayload(record);
    if (canonicalContent(current) === canonicalContent(sent))
      await writePayload(record);
    await bases.put(record);
  });
}
async function runSync(): Promise<void> {
  useSyncStatus.setState({ running: true, error: "" });
  try {
    if (!navigator.onLine)
      throw new Error("当前离线，本地修改已保存，联网后继续同步");
    const remote = new Map((await remoteSnapshot()).map((r) => [r.key, r]));
    const [local, baseRows, conflictRows] = await Promise.all([
      localSnapshot(),
      bases.toArray(),
      conflicts.toArray(),
    ]);
    const base = new Map(baseRows.map((r) => [r.key, r]));
    const blocked = new Set(
      conflictRows.filter((r) => !r.resolved).map((r) => r.key),
    );
    const changes: SyncChange[] = [];
    for (const key of new Set([
      ...local.keys(),
      ...base.keys(),
      ...remote.keys(),
    ])) {
      if (blocked.has(key)) continue;
      const b = base.get(key),
        r = remote.get(key),
        l = local.get(key) ?? null;
      const identity = r ?? b;
      const table =
        identity?.table ??
        (key.slice(0, key.indexOf(":")) as RemoteRecord["table"]);
      const recordId = identity?.recordId ?? key.slice(key.indexOf(":") + 1);
      // 服务端保留墓碑，已同步记录突然消失意味着换库/服务端重置，必须让站主选择。
      if (b?.payload && !r) {
        await rememberConflict(
          { key, table, recordId, payload: null, revision: "" },
          l,
          b,
        );
        continue;
      }
      const decision = decideMerge(b?.payload ?? null, l, r?.payload ?? null);
      if (decision === "conflict") {
        await rememberConflict(r!, l, b ?? null);
        continue;
      }
      if (decision === "push") {
        changes.push({
          table,
          recordId,
          payload: l,
          baseRevision: r?.revision ?? null,
        });
        continue;
      }
      if (r) {
        await db.transaction(
          "rw",
          [db.table(table), bases, conflicts],
          async () => {
            const now = await currentPayload(r);
            if (canonicalContent(now) !== canonicalContent(l)) return; // 读取快照后本地又编辑，留到下一轮。
            if (decision === "pull") await writePayload(r);
            await bases.put(r);
          },
        );
      }
    }
    // 删除/创建都由已持久化业务副本与基线派生；此 outbox 保存当前网络批次。
    for (let offset = 0; offset < changes.length; offset += 200) {
      const batch = changes.slice(offset, offset + 200);
      await pending.put({ id: "inflight", changes: batch });
      const result = await request<SyncResult>("POST", {
        schemaVersion: SYNC_VERSION,
        changes: batch,
      });
      const sent = new Map(
        batch.map((c) => [recordKey(c.table, c.recordId), c]),
      );
      for (const r of result.records)
        await acknowledge(r, sent.get(r.key)!.payload);
      for (const r of result.conflicts)
        await rememberConflict(
          r,
          await currentPayload(r),
          base.get(r.key) ?? null,
        );
      await pending.delete("inflight");
    }
    const when = Date.now();
    await pending.put({ id: "lastSync", value: when });
    useSyncStatus.setState({ lastSync: when, pending: 0 });
  } catch (error) {
    useSyncStatus.setState({
      error:
        error instanceof Error ? error.message : "同步失败，本地修改已保留",
    });
  } finally {
    useSyncStatus.setState({ running: false });
  }
}
export function synchronize(): Promise<void> {
  if (active) return active;
  const task = () => runSync();
  // 同源多标签也共享同步锁；不同设备通过服务端 CAS 串行比较。
  active = (
    "locks" in navigator
      ? navigator.locks.request("byqx-cadence-sync", task)
      : task()
  ).finally(() => {
    active = null;
  });
  return active;
}
export async function enableSync(): Promise<void> {
  await pending.put({ id: "enabled", value: true });
  useSyncStatus.setState({ enabled: true });
  await synchronize();
}
export async function disableSync(): Promise<void> {
  await pending.put({ id: "enabled", value: false });
  useSyncStatus.setState({ enabled: false, error: "" });
}
export async function resolveConflict(
  copy: ConflictCopy,
  choice: "local" | "remote",
): Promise<void> {
  const local = await currentPayload(copy.remote);
  if (canonicalContent(local) !== canonicalContent(copy.local)) {
    await rememberConflict(copy.remote, local, copy.base);
    throw new Error("本地内容又有修改，已更新冲突副本，请重新选择");
  }
  const payload = choice === "local" ? local : copy.remote.payload;
  const result = await request<SyncResult>("POST", {
    schemaVersion: SYNC_VERSION,
    changes: [
      {
        table: copy.remote.table,
        recordId: copy.remote.recordId,
        payload,
        baseRevision: copy.remote.revision || null,
      },
    ],
  });
  if (result.conflicts[0]) {
    await rememberConflict(result.conflicts[0], local, copy.base);
    throw new Error("远端又有修改，已保留新版本，请重新比较");
  }
  const accepted = result.records[0]!;
  await acknowledge(accepted, local);
  // 解决后的败方仍保留在本地历史副本中，便于恢复。
  await conflicts.put({ ...copy, resolved: true });
}

/** 恢复历史版作为一次新的本地编辑；保留被替换内容，下一轮仍走三方同步。 */
export async function restoreConflictVersion(
  copy: ConflictCopy,
  choice: "local" | "remote",
): Promise<void> {
  await db.transaction("rw", [...SYNC_TABLES, conflicts], async () => {
    const latest = await conflicts.get(copy.key);
    if (!latest?.resolved) throw new Error("请先解决此记录当前的同步冲突");
    const previous = await currentPayload(copy.remote);
    const payload = choice === "local" ? copy.local : copy.remote.payload;
    await writePayload({
      ...copy.remote,
      payload: payload ? { ...payload, updatedAt: Date.now() } : null,
    });
    const snapshot = await localSnapshot();
    validateCadenceSnapshot(
      [...snapshot].map(([key, value]) => {
        const table = key.slice(0, key.indexOf(":")) as RemoteRecord["table"];
        return {
          key,
          table,
          recordId: payloadId(table, value),
          payload: value,
          revision: "",
        };
      }),
    );
    await conflicts.put({
      ...latest,
      history: [
        ...(latest.history ?? []),
        { ...copy.remote, payload: previous, revision: `local:${Date.now()}` },
      ],
    });
  });
}

/** 生命周期由岛控制，离开页面清除监听与定时器。 */
export function startSyncWatching(): () => void {
  let stopped = false;
  void Promise.all([pending.get("enabled"), pending.get("lastSync")]).then(
    ([enabled, last]) => {
      if (stopped) return;
      useSyncStatus.setState({
        enabled: enabled?.value === true,
        lastSync: typeof last?.value === "number" ? last.value : null,
      });
      if (enabled?.value) void synchronize();
    },
  );
  const dirty = () => {
    useSyncStatus.setState((s) => ({ pending: s.pending + 1 }));
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => {
      if (!stopped && useSyncStatus.getState().enabled) void synchronize();
    }, 1800);
  };
  // Dexie 存储事件跨标签生效；只关注业务表，不因同步基线写入而循环触发。
  const onMutation = (parts: Record<string, unknown>) => {
    if (
      Object.keys(parts).some((part) =>
        SYNC_TABLES.some((table) => part.includes(`/${db.name}/${table}/`)),
      )
    )
      dirty();
  };
  Dexie.on("storagemutated", onMutation);
  const online = () => {
    if (useSyncStatus.getState().enabled) void synchronize();
  };
  window.addEventListener("online", online);
  const interval = setInterval(online, 30_000);
  return () => {
    stopped = true;
    clearTimeout(dirtyTimer);
    clearInterval(interval);
    window.removeEventListener("online", online);
    Dexie.on("storagemutated").unsubscribe(onMutation);
  };
}
