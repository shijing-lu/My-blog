/**
 * 云端 PostgreSQL 端点（主库 + 可选备库镜像写）
 *
 * ## 为什么写要镜像到备库
 * 云端本身是「主 + 备双写镜像」（既有 `DATABASE_URL` + `DATABASE_URL_FALLBACK`，
 * 见 `db/index.ts` 的 dualWriteProxy）。若桌面端同步只写主库，备库就会过期；
 * 而 Web 端在主库故障时会读备库 → 访客看到旧内容。因此这里的写操作同样镜像两份，
 * **备库失败只记警告、不阻断**（与既有双写语义一致）。
 *
 * ## 安全
 * 表名/列名来自 `src/sync/tables.ts` 注册表；值全部参数化（postgres.js 模板参数）。
 */
import postgres from 'postgres';
import type { SyncRow } from '../core/types';
import { splitRowId, type SyncEndpoint } from './source';

type Sql = ReturnType<typeof postgres>;

/**
 * postgres.js 的参数类型（从 `unsafe` 签名推导）。
 * 值来自数据库行，列类型在编译期不可知 —— 用签名推导 + 局部收窄，
 * 既不用 `any`，也不放过真正的类型错误。
 */
type UnsafeParams = Parameters<Sql['unsafe']>[1];
const asParams = (values: unknown[]): UnsafeParams => values as UnsafeParams;

export interface PgEndpointOptions {
  /** 主库连接串（云端唯一读取源） */
  primaryUrl: string;
  /** 备库连接串（可选；仅用于镜像写） */
  fallbackUrl?: string;
  /** 备库写失败时的回调（用于记入报告 warnings） */
  onFallbackError?: (message: string) => void;
}

export class PgEndpoint implements SyncEndpoint {
  readonly name = 'cloud';
  private readonly primary: Sql;
  private readonly fallback: Sql | null;
  private readonly onFallbackError: (message: string) => void;
  private readonly columnTypes = new Map<string, Promise<Map<string, string>>>();

  constructor(opts: PgEndpointOptions) {
    // idle_timeout：长时间空闲后回收连接（桌面端常驻进程，避免用陈旧连接）
    // max_lifetime：强制轮换，防止云侧静默断开后被复用
    const clientOpts = { max: 1, connect_timeout: 10, idle_timeout: 30, max_lifetime: 60 * 30 };
    this.primary = postgres(opts.primaryUrl, clientOpts);
    this.fallback = opts.fallbackUrl ? postgres(opts.fallbackUrl, clientOpts) : null;
    this.onFallbackError = opts.onFallbackError ?? (() => {});
  }

  async readRows(table: string): Promise<SyncRow[]> {
    const rows = await this.primary`SELECT * FROM ${this.primary(table)}`;
    return rows as unknown as SyncRow[];
  }

  async upsertRows(table: string, rows: SyncRow[], pk: string[]): Promise<number> {
    if (rows.length === 0) return 0;
    const types = await this.typesFor(table);
    // One network round trip per batch; row-by-row writes can take minutes.
    const groups = new Map<string, SyncRow[]>();
    for (const row of rows) {
      const key = JSON.stringify(Object.keys(row).sort());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    let n = 0;
    for (const group of groups.values()) {
      const cols = Object.keys(group[0]!);
      if (cols.length === 0) continue;
      for (let offset = 0; offset < group.length; offset += 50) {
        const batch = group.slice(offset, offset + 50);
        const values = batch.flatMap(row => cols.map(col => normalizePgValue(row[col], types.get(col))));
        const tuples = batch.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(', ')})`).join(', ');
        const updates = cols.filter(col => !pk.includes(col)).map(col => `"${col}" = EXCLUDED."${col}"`).join(', ');
        const conflict = pk.length ? ` ON CONFLICT (${pk.map(col => `"${col}"`).join(', ')}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}` : '';
        const stmt = `INSERT INTO "${table}" (${cols.map(col => `"${col}"`).join(', ')}) VALUES ${tuples}${conflict}`;
        await this.primary.unsafe(stmt, asParams(values));
        await this.mirror(stmt, values);
        n += batch.length;
      }
    }
    return n;
  }

  async updateRows(table: string, rows: SyncRow[], pk: string[]): Promise<number> {
    let n = 0;
    for (const row of rows) {
      if (await this.writeOne('update', table, row, pk)) n += 1;
    }
    return n;
  }

  async deleteRows(table: string, ids: string[], pk: string[]): Promise<number> {
    let n = 0;
    for (const id of ids) {
      const values = splitRowId(id);
      const where = pk.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
      try {
        await this.primary.unsafe(`DELETE FROM "${table}" WHERE ${where}`, asParams(values));
        await this.mirror(`DELETE FROM "${table}" WHERE ${where}`, values);
        n += 1;
      } catch (err) {
        throw err; // 主库失败必须抛出（由 engine 记为表失败并续传）
      }
    }
    return n;
  }

  /** 单行的 upsert / update（主库执行 + 备库镜像） */
  private async writeOne(
    kind: 'upsert' | 'update',
    table: string,
    row: SyncRow,
    pk: string[],
  ): Promise<boolean> {
    const cols = Object.keys(row);
    if (cols.length === 0) return false;
    const types = await this.typesFor(table);
    const value = (column: string) => normalizePgValue(row[column], types.get(column));

    if (kind === 'upsert') {
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      // 冲突即整行覆盖（与 SQLite 的 REPLACE 语义对齐）
      const updates = cols
        .filter((c) => !pk.includes(c))
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');
      const conflict = pk.length > 0 ? ` ON CONFLICT (${pk.map((c) => `"${c}"`).join(', ')}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}` : '';
      const stmt = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})${conflict}`;
      const values = cols.map(value);
      await this.primary.unsafe(stmt, asParams(values));
      await this.mirror(stmt, values);
      return true;
    }

    const setCols = cols.filter((c) => !pk.includes(c));
    if (setCols.length === 0) return false;
    const set = setCols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const where = pk.map((c, i) => `"${c}" = $${setCols.length + i + 1}`).join(' AND ');
    const stmt = `UPDATE "${table}" SET ${set} WHERE ${where}`;
    const values = [...setCols.map(value), ...pk.map(value)];
    await this.primary.unsafe(stmt, asParams(values));
    await this.mirror(stmt, values);
    return true;
  }

  private typesFor(table: string): Promise<Map<string, string>> {
    let types = this.columnTypes.get(table);
    if (!types) {
      types = this.primary.unsafe(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', table],
      ).then(rows => new Map(rows.map(row => [String(row.column_name), String(row.data_type)])));
      this.columnTypes.set(table, types);
      void types.catch(() => this.columnTypes.delete(table));
    }
    return types;
  }

  /** 备库镜像写：失败只告警（保持与既有双写一致的"尽力同步"语义） */
  private async mirror(stmt: string, values: unknown[]): Promise<void> {
    if (!this.fallback) return;
    try {
      await this.fallback.unsafe(stmt, asParams(values));
    } catch (err) {
      this.onFallbackError(`备库镜像写失败（已跳过，不影响主库）：${(err as Error).message}`);
    }
  }

  async close(): Promise<void> {
    await this.primary.end({ timeout: 5 }).catch(() => {});
    if (this.fallback) await this.fallback.end({ timeout: 5 }).catch(() => {});
  }
}

/** SQLite uses milliseconds, 0/1 and JSON text; PG requires typed wire values. */
export function normalizePgValue(value: unknown, type?: string): unknown {
  if (value === undefined || value === null) return null;
  if (type?.startsWith('timestamp')) {
    const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null;
    if (date) {
      // postgres.js reads legacy timestamp-without-zone columns in the client's
      // local zone. Write the corresponding wall time so their epoch round-trips.
      if (type === 'timestamp without time zone') {
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
      }
      return date.toISOString();
    }
  }
  if (type === 'boolean' && typeof value === 'number') return value !== 0;
  if ((type === 'json' || type === 'jsonb') && typeof value === 'object') return JSON.stringify(value);
  return value;
}
