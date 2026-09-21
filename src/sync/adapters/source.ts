/**
 * 同步端点接口（适配器层契约）
 *
 * 为什么用「参数化原始 SQL」而不是 drizzle 表对象：
 * - 同步是**元数据驱动**的（按表名/主键列/角色遍历 30 张表），
 *   用 drizzle 需要先做「表名 → 表对象」映射，且两侧方言对象不同；
 * - 既有的 `src/lib/db-sync.ts`（云端双库对账）已用同一思路，保持一致；
 * - 表名/列名全部来自 `src/sync/tables.ts` 注册表（非用户输入），
 *   值一律走占位符参数化，无注入风险。
 *
 * 依赖方向：engine 只依赖本接口 → 可以塞入任意实现（含测试用的 SQLite 替身）。
 */
import type { SyncRow } from '../core/types';

export interface SyncEndpoint {
  /** 端点名（用于日志/报告：local / cloud-primary / cloud-fallback） */
  readonly name: string;

  /** 读取整表（大数据量表由调用方分批；本项目单行集规模很小） */
  readRows(table: string): Promise<SyncRow[]>;

  /** 插入（已存在则覆盖，保证幂等） */
  upsertRows(table: string, rows: SyncRow[], pk: string[]): Promise<number>;

  /** 按主键更新（只更新给出的列；pk 列不更新） */
  updateRows(table: string, rows: SyncRow[], pk: string[]): Promise<number>;

  /** 按主键删除 */
  deleteRows(table: string, ids: string[], pk: string[]): Promise<number>;

  /** 关闭连接（测试与进程退出时调用） */
  close(): Promise<void>;
}

/** 行 id（复合主键用 \u001f 连接）还原为主键值数组 */
export function splitRowId(id: string): string[] {
  return id.split('\u001f');
}

/** 主键值数组拼成行 id */
export function joinRowId(values: string[]): string {
  return values.join('\u001f');
}
