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
    let n = 0;
    for (const row of rows) {
      if (await this.writeOne('upsert', table, row, pk)) n += 1;
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
      const values = cols.map((c) => row[c]);
      await this.primary.unsafe(stmt, asParams(values));
      await this.mirror(stmt, values);
      return true;
    }

    const setCols = cols.filter((c) => !pk.includes(c));
    if (setCols.length === 0) return false;
    const set = setCols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const where = pk.map((c, i) => `"${c}" = $${setCols.length + i + 1}`).join(' AND ');
    const stmt = `UPDATE "${table}" SET ${set} WHERE ${where}`;
    const values = [...setCols.map((c) => row[c]), ...pk.map((c) => row[c])];
    await this.primary.unsafe(stmt, asParams(values));
    await this.mirror(stmt, values);
    return true;
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
    await this.primary.end().catch(() => {});
    if (this.fallback) await this.fallback.end().catch(() => {});
  }
}
