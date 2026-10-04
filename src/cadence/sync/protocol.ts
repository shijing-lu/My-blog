/** 同步协议仅依赖 JSON。revision 是服务端生成的 CAS 令牌。 */
export const SYNC_VERSION = 1;
export const SYNC_TABLES = [
  "plans",
  "tasks",
  "sessions",
  "reviewSchedules",
  "reviewEntries",
  "todos",
  "axisConfigs",
  "dailyPlans",
  "scheduleEvents",
  "countdowns",
  "settings",
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export type EntityPayload = Record<string, unknown>;
export interface RemoteRecord {
  key: string;
  table: SyncTable;
  recordId: string;
  payload: EntityPayload | null;
  revision: string;
}
export interface SyncChange {
  table: SyncTable;
  recordId: string;
  payload: EntityPayload | null;
  baseRevision: string | null;
}
export interface SyncResult {
  records: RemoteRecord[];
  conflicts: RemoteRecord[];
}
export function recordKey(table: SyncTable, id: string): string {
  return `${table}:${id}`;
}
export function payloadId(table: SyncTable, payload: EntityPayload): string {
  return String(payload[table === "settings" ? "key" : "id"]);
}
/** 时间元数据不构成业务内容变化，两设备默认轴的初始化时间可以不同。 */
export function canonicalContent(payload: EntityPayload | null): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, normalize(v)]),
      );
    return value;
  };
  if (payload === null) return "null";
  const { createdAt: _created, updatedAt: _updated, ...content } = payload;
  return JSON.stringify(normalize(content));
}
export type MergeDecision = "equal" | "push" | "pull" | "conflict";
export function decideMerge(
  base: EntityPayload | null,
  local: EntityPayload | null,
  remote: EntityPayload | null,
): MergeDecision {
  const b = canonicalContent(base),
    l = canonicalContent(local),
    r = canonicalContent(remote);
  if (l === r) return "equal";
  if (l === b) return "pull";
  if (r === b) return "push";
  return "conflict";
}
export function validateCadenceSnapshot(records: RemoteRecord[]): void {
  const days = new Map<string, Array<{ start: number; end: number }>>();
  const unique = new Set<string>();
  let activeSessions = 0;
  const tasks = new Map(
    records
      .filter((r) => r.table === "tasks" && r.payload)
      .map((r) => [r.recordId, r.payload!]),
  );
  for (const record of records) {
    const p = record.payload;
    if (p === null) continue;
    if (record.table === "tasks" && !p.deletedAt) {
      let parentId = p.parentId,
        depth = 1;
      const seen = new Set([record.recordId]);
      while (typeof parentId === "string") {
        if (seen.has(parentId)) throw new Error("任务父子关系包含循环");
        seen.add(parentId);
        const parent = tasks.get(parentId);
        if (!parent) break;
        if (parent.planId !== p.planId)
          throw new Error("父任务和子任务必须属于同一计划");
        if (++depth > 3) throw new Error("任务层级不能超过三层");
        parentId = parent.parentId;
      }
    }
    if (record.table === "axisConfigs") {
      const regions = p.regions as Array<{
        id: string;
        x0: number;
        x1: number;
        y0: number;
        y1: number;
      }>;
      if (
        !regions.length ||
        regions.some((r) => r.x0 >= r.x1 || r.y0 >= r.y1) ||
        !regions.some((r) => r.id === p.fallbackZoneId) ||
        new Set(regions.map((r) => r.id)).size !== regions.length
      )
        throw new Error("待办坐标配置的分区边界或默认分区不合法");
    }
    if (record.table === "scheduleEvents") {
      const start = Number(p.startMin),
        end = Number(p.endMin),
        day = String(p.dateKey);
      if (end - start < 15 || start % 15 || end % 15)
        throw new Error("日程需以 15 分钟对齐，且至少持续 15 分钟");
      const spans = days.get(day) ?? [];
      if (spans.some((s) => start < s.end && s.start < end))
        throw new Error(`${day} 的日程时间重叠，请调整本地安排后重试`);
      spans.push({ start, end });
      days.set(day, spans);
    }
    if (record.table === "sessions") {
      if (p.endedAt === undefined) activeSessions++;
      else if (Number(p.endedAt) < Number(p.startedAt))
        throw new Error("执行记录结束时间不能早于开始时间");
      if (
        p.pausedAt !== undefined &&
        (p.endedAt !== undefined || Number(p.pausedAt) < Number(p.startedAt))
      )
        throw new Error("执行记录暂停时间不合法");
      if (
        Number(p.pausedMs ?? 0) >
        Number(p.endedAt ?? p.pausedAt ?? Number.MAX_SAFE_INTEGER) -
          Number(p.startedAt)
      )
        throw new Error("执行记录暂停时长超过总时长");
    }
    if (record.table === "dailyPlans" || record.table === "reviewEntries") {
      const key =
        record.table === "dailyPlans"
          ? `day:${p.dateKey}`
          : `review:${p.scheduleId}:${p.slotStart}`;
      if (unique.has(key))
        throw new Error("同一天或同一复盘格存在重复记录，请保留一份后同步");
      unique.add(key);
    }
  }
  if (activeSessions > 1)
    throw new Error("多个设备存在进行中的专注，请先结束其中一段再同步");
}
