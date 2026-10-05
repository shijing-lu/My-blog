/**
 * Repository 接口
 * 依据：02-技术架构文档 §4 / ADR-02
 *
 * 为什么要有这一层（而不是让组件直接 `db.todos.put(...)`）：
 *   1. **可替换**：Web 用 Dexie，Tauri 用 SQLite，Capacitor 用 sqlite 插件。
 *      三者的查询语法完全不同，但业务语义相同 —— 接口就是那个"相同"。
 *   2. **可测试**：用例层可以对着内存实现测试，不需要 IndexedDB。
 *   3. **统一横切逻辑**：updatedAt 维护、软删除、级联删除这些事
 *      散落在组件里必然会有遗漏（漏一个 updatedAt 就会导致排序错乱）。
 *
 * 约定：
 *   - 所有方法都接收 `now`（UTC ms）而不是自己取当前时间 —— 与派生逻辑同一纪律，
 *     用例层因此完全可测。
 *   - `list()` 只返回未删除的；回收站用 `listTrash()`。
 */

import type { Session } from '@/cadence/entities/session'
import type { Task } from '@/cadence/entities/task'
import type { Todo } from '@/cadence/entities/todo'

/**
 * 实体的最小结构约束（不含软删除 —— 不是所有实体都可软删除，
 * 如执行记录是纯历史数据，删除即永久删除）
 */
export interface HasId {
  id: string
  createdAt: number
  updatedAt: number
}

/** 可软删除的实体约束 */
export interface SoftDeletableId extends HasId {
  /** 0 = 未删除（哨兵值，保证"未删除/回收站"查询都能命中索引）；> 0 = 删除时间 */
  deletedAt: number
}

/**
 * 基础仓储能力（不含软删除 —— 执行记录这类纯历史数据"删除即永久删除"）
 */
export interface EntityCore<T extends HasId> {
  /** 按 id 取单条 */
  get(id: string): Promise<T | undefined>
  /**
   * 新增或更新。
   * createdAt 为空时按 now 补齐；否则自动刷新 updatedAt。
   * 调用方不需要（也不应该）手动维护这两个字段。
   */
  put(entity: T, now: number): Promise<T>
  /** 彻底删除（不可恢复） */
  purge(id: string): Promise<void>
}

/**
 * 软删除能力（回收站）
 * 计划 / 任务 / 待办 / 复盘配置是"用户数据"，删除先进回收站保留 30 天。
 */
export interface SoftDeleteRepository<T extends SoftDeletableId> extends EntityCore<T> {
  /** 全部未删除的实体 */
  list(): Promise<T[]>
  /** 全部已删除的实体（回收站），按删除时间倒序 */
  listTrash(): Promise<T[]>
  /** 软删除：写入 deletedAt。级联行为由具体实体的 repo 定义 */
  softDelete(id: string, now: number): Promise<void>
  /** 从回收站恢复 */
  restore(id: string, now: number): Promise<void>
  /** 未删除数量 */
  count(): Promise<number>
}

/** 完整仓储 = 基础 + 软删除 */
export type EntityRepository<T extends SoftDeletableId> = EntityCore<T> & SoftDeleteRepository<T>

/** 待办仓储的额外查询（由复合索引 [status+dueAt] 支撑） */
export interface TodoQuery {
  /** 未完成且即将到期；dueAt 为空的排除 */
  dueWithin(now: number, withinMs: number): Promise<Todo[]>
  /** 某轴配置下的全部待办（XY 视图） */
  byAxis(axisConfigId: string): Promise<Todo[]>
}

/** 任务仓储的额外查询（复合索引 [planId+status] 支撑） */
export interface TaskQuery {
  /** 计划下的任务，按 order 排序 */
  byPlan(planId: string): Promise<Task[]>
}

/** 执行记录仓储的额外查询（复合索引 [startedAt+endedAt] 支撑区间查询） */
export interface SessionQuery {
  /** 与 [from, to] 区间相交的记录 */
  inRange(from: number, to: number): Promise<Session[]>
}
