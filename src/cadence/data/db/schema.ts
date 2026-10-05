/**
 * Dexie Schema —— 唯一 Schema 真相源
 * 依据：02-技术架构文档 §4.1
 *
 * 索引纪律：Dexie 只索引 `stores()` 里列出的字段，对未索引字段做 where()
 * 会退化为全表扫描。**新增查询条件时先加索引再写查询。**
 */

import Dexie, { type EntityTable } from 'dexie'

import type { Plan } from '@/cadence/entities/plan'
import type { Task } from '@/cadence/entities/task'
import type { Session } from '@/cadence/entities/session'
import type { ReviewEntry, ReviewSchedule } from '@/cadence/entities/review'
import type { Todo } from '@/cadence/entities/todo'
import type { AxisConfig } from '@/cadence/entities/axis'
import type { DailyPlan } from '@/cadence/entities/daily-plan'
import type { Countdown } from '@/cadence/entities/countdown'
import type { ScheduleEvent } from '@/cadence/entities/schedule'

/** 迁移前快照（回收站之外的第二道保险） */
export interface SnapshotRow {
  id: string
  createdAt: number
  /** 触发快照的原因：版本升级 / 用户手动 */
  reason: 'upgrade' | 'manual'
  /** 导出的 JSON 串（与 exportBundle 的 data 部分同构） */
  payload: string
}

/** 键值设置行（主题、动效强度、锚点时区等） */
export interface SettingRow {
  key: string
  value: unknown
  updatedAt: number
}

export class CadenceDatabase extends Dexie {
  plans!: EntityTable<Plan, 'id'>
  tasks!: EntityTable<Task, 'id'>
  sessions!: EntityTable<Session, 'id'>
  reviewSchedules!: EntityTable<ReviewSchedule, 'id'>
  reviewEntries!: EntityTable<ReviewEntry, 'id'>
  todos!: EntityTable<Todo, 'id'>
  axisConfigs!: EntityTable<AxisConfig, 'id'>
  dailyPlans!: EntityTable<DailyPlan, 'id'>
  scheduleEvents!: EntityTable<ScheduleEvent, 'id'>
  countdowns!: EntityTable<Countdown, 'id'>
  settings!: EntityTable<SettingRow, 'key'>
  snapshots!: EntityTable<SnapshotRow, 'id'>
}

/**
 * 当前 Schema 版本
 *
 * ⚠️ 纪律（02-技术架构文档 §4.2）：已发布的版本号**永不复用**。
 * 任何结构变更（加索引 / 加表 / 改字段语义）都必须递增此数字并补 upgrade 回调。
 */
export const SCHEMA_VERSION = 1

/** IndexedDB 数据库名。改名等于换库 —— 永远不要动它 */
export const DATABASE_NAME = 'byqx-cadence'

/** 全部业务表名（导入导出 / 快照 / 清理时遍历用） */
export const BUSINESS_TABLES = [
  'plans',
  'tasks',
  'sessions',
  'reviewSchedules',
  'reviewEntries',
  'todos',
  'axisConfigs',
  'dailyPlans',
  'scheduleEvents',
  'countdowns',
  'settings',
] as const

export type BusinessTableName = (typeof BUSINESS_TABLES)[number]

/** v1 的表定义。此后的版本通过 db.version(n) 追加，不要回改这里 */
export const SCHEMA_V1: Record<string, string> = {
  plans: 'id, status, startDate, endDate, updatedAt, deletedAt, *tags',
  tasks: 'id, planId, parentId, status, order, updatedAt, deletedAt, [planId+status]',
  // [startedAt+endedAt] 支撑"某时间区间内的执行记录"区间查询
  sessions: 'id, taskId, planId, startedAt, endedAt, updatedAt, [startedAt+endedAt]',
  reviewSchedules: 'id, enabled, order, updatedAt, deletedAt',
  // ★ 唯一复合索引：一个周期格只能有一条复盘，put() 天然幂等
  reviewEntries: 'id, &[scheduleId+slotStart], dateKey, scheduleId, updatedAt, deletedAt',
  todos: 'id, status, dueAt, updatedAt, deletedAt, axisConfigId, *tags, [status+dueAt]',
  axisConfigs: 'id, isDefault, updatedAt',
  // dateKey 唯一：一天只有一份日计划（id 本身也由 dateKey 派生，双保险）
  dailyPlans: 'id, &dateKey, updatedAt',
  scheduleEvents: 'id, dateKey, updatedAt',
  countdowns: 'id, order, updatedAt, deletedAt',
  settings: 'key',
  snapshots: 'id, createdAt, reason',
}
