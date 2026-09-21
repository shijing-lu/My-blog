/**
 * 行内容哈希（稳定、确定性）
 *
 * 用途：判断「这一行到底改没改」。为什么不用整行 JSON.stringify？
 * - 键顺序不稳定（不同驱动/方言返回列顺序可能不同）→ 必须排序；
 * - 时间可能是 Date / number / string 三种形态 → 统一归一为 ms epoch；
 * - null / undefined 语义不同但视觉上都是"空" → 统一归一，避免误判为修改。
 */
import { createHash } from 'node:crypto';
import type { SyncRow } from './types';

/** 复合主键连接符（不可见字符，避免与业务值冲突） */
export const ID_SEP = '\u001f';

/**
 * 严格 ISO 日期时间串：`2023-11-14T22:13:20.000Z` / `2023-11-14T22:13:20+08:00`
 * ⚠️ 故意**不**匹配纯日期（`2023-11-14`）与日期前缀的 slug（`2023-11-14-标题`）：
 *    后者是业务字符串，转成时间戳会误判内容变更。
 */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** 把任意值归一为可稳定序列化的形态 */
function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  // ⚠️ 布尔必须归一为 0/1：云 PG 布尔列读回 true/false，本地 SQLite 存 0/1，
  //    不归一就会每次同步都误判"有变更"→ 幂等失效、反复拉取（实测 54 个假动作）。
  //    同列类型唯一，故 1 ≡ true 不会与数值列产生歧义。
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (Buffer.isBuffer(value)) return `buf:${value.toString('base64')}`;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = normalize(src[key]);
    return out;
  }
  // 同一列在两种方言下可能是 Date（PG）/ 整数毫秒（SQLite）/ ISO 字符串（PG 文本模式），
  // 统一成毫秒才能跨方言比较——否则每次同步都误判"有变更"。
  if (typeof value === 'string' && ISO_DATETIME.test(value)) {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  // JSON 列跨方言归一：PG 的 jsonb 会返回**已解析**的数组/对象，SQLite 存的是 TEXT 字符串
  // （实测 articles.tags：本地 '["x"]' ↔ 云端 ["x"] → 反复误判变更）。
  // 只解析以 [ / { 开头的字符串，避免把普通文本（如标题 "123"）误当结构。
  if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
    try {
      return normalize(JSON.parse(value));
    } catch {
      /* 非法 JSON：按普通字符串处理 */
    }
  }
  return value;
}

/** 行内容哈希（sha256 前 32 位十六进制，够用且短） */
export function rowHash(row: SyncRow, columns?: string[]): string {
  const keys = (columns ?? Object.keys(row)).slice().sort();
  const payload: Record<string, unknown> = {};
  for (const key of keys) payload[key] = normalize(row[key]);
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/** 由主键列拼出行标识；缺失主键值用空串兜底（由调用方保证完整性） */
export function rowId(row: SyncRow, pk: string[]): string {
  return pk.map((col) => String(row[col] ?? '')).join(ID_SEP);
}

/** 取行的时间戳（ms）；支持 Date / number / 数字字符串，无法解析返回 null */
export function rowUpdatedAt(row: SyncRow, column = 'updated_at'): number | null {
  const raw = row[column];
  if (raw === undefined || raw === null) return null;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  // drizzle 的 timestamp 模式可能返回 Date，也可能由方言给出字符串；其余类型无法比较
  return null;
}

/** 取 created_at 作为无 updated_at 时的保守基准（ms） */
export function rowCreatedAt(row: SyncRow, column = 'created_at'): number | null {
  return rowUpdatedAt(row, column);
}
