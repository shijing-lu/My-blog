/**
 * Zod Schema + 导入导出
 * 依据：02-技术架构文档 §4.4
 *
 * 导入前的兼容性处理链（顺序不可调换）：
 *   版本检查 → Zod 结构校验 → 字段归一化（补默认值 / 收敛非法坐标）→ 单事务写入 → 一致性自检
 *
 * **不静默部分写入**：任何一步失败都整体拒绝。
 * 用户宁可看到"这个文件导入不了"，也不要"导进去一半，另一半静默丢了"。
 */

import { z } from 'zod'

import type { AxisConfig } from '@/cadence/entities/axis'
import { defaultAxisConfig } from '@/cadence/entities/axis'
import { clampCoordinate, type TodoStatus } from '@/cadence/entities/todo'
import type { PlanStatus } from '@/cadence/entities/plan'
import type { TaskStatus } from '@/cadence/entities/task'
import { newEntityId } from '@/cadence/shared/model/entity'
import { type CadenceDatabase } from './database'
import { BUSINESS_TABLES, SCHEMA_VERSION, type BusinessTableName } from './schema'
import { NOT_DELETED } from '@/cadence/shared/model/entity'

import { ExportBundleSchema } from './validation'
import { validateCadenceSnapshot } from '@/cadence/sync/protocol'
export { ExportBundleSchema } from './validation'

export type ExportBundle = z.infer<typeof ExportBundleSchema>

/* ── 导出 ── */

/** 从数据库读出全部业务数据并组装成可导出的包 */
export async function buildExportBundle(
  database: CadenceDatabase,
  appVersion: string,
  exportedAt: number,
): Promise<ExportBundle> {
  const read = async (name: BusinessTableName) => database.table(name).toArray()

  const [
    plans,
    tasks,
    sessions,
    reviewSchedules,
    reviewEntries,
    todos,
    axisConfigs,
    dailyPlans,
    scheduleEvents,
    countdowns,
    settings,
  ] = await Promise.all([
    read('plans'),
    read('tasks'),
    read('sessions'),
    read('reviewSchedules'),
    read('reviewEntries'),
    read('todos'),
    read('axisConfigs'),
    read('dailyPlans'),
    read('scheduleEvents'),
    read('countdowns'),
    read('settings'),
  ])

  return ExportBundleSchema.parse({
    format: 'cadence-export',
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    appVersion,
    data: {
      plans,
      tasks,
      sessions,
      reviewSchedules,
      reviewEntries,
      todos,
      axisConfigs,
      dailyPlans,
      scheduleEvents,
      countdowns,
      settings,
    },
  })
}

/* ── 导入 ── */

export type ImportIssue = { path: string; message: string }

export type ImportResult =
  | { ok: true; stats: Record<BusinessTableName, number> }
  | { ok: false; reason: 'bad_format' | 'version_too_new' | 'invalid_data' | 'write_failed'; issues?: ImportIssue[] }

/**
 * 字段归一化：旧版本数据补默认值、收敛非法值
 *
 * 这是"版本兼容"的落点。v1 没有历史版本要兼容，
 * 但函数签名与位置从第一天就留好 —— 迁移逻辑在这里加，而不是散落在导入流程里。
 */
function normalizeBundle(bundle: ExportBundle): ExportBundle {
  const data = { ...bundle.data }

  // 软删除哨兵：旧数据 / 手工编辑的文件可能缺 deletedAt，统一补 0（未删除）。
  // 缺失值不会进入索引，会让这些记录从列表里"消失"
  const withDeletedFlag = <T extends { deletedAt?: number | undefined }>(
    rows: T[],
  ): (T & { deletedAt: number })[] =>
    rows.map((row) => ({ ...row, deletedAt: row.deletedAt ?? NOT_DELETED }))

  data.plans = withDeletedFlag(data.plans)
  data.tasks = withDeletedFlag(data.tasks)
  data.reviewEntries = withDeletedFlag(data.reviewEntries)
  data.reviewSchedules = withDeletedFlag(data.reviewSchedules)
  data.todos = withDeletedFlag(data.todos)
  data.countdowns = withDeletedFlag(data.countdowns)

  // 待办坐标收敛到 0–100：旧数据 / 浮点误差 / 手工编辑过的文件都可能出现越界值。
  // 参数类型用 Zod 推断的形状（deletedAt 可选），不要标注成 Todo —— 实体的 deletedAt 是必填
  data.todos = data.todos.map((todo) => ({
    ...todo,
    coordinate: clampCoordinate(todo.coordinate),
  }))

  // 轴配置缺省时补一个内置四象限，避免导入后 XY 视图无轴可用
  if (data.axisConfigs.length === 0) {
    const fallback: AxisConfig = defaultAxisConfig(Date.now())
    data.axisConfigs = [fallback]
    data.todos = data.todos.map((todo) =>
      todo.axisConfigId === fallback.id ? todo : { ...todo, axisConfigId: fallback.id },
    )
  }

  // 无默认轴时，把第一个轴设为默认
  if (!data.axisConfigs.some((axis) => axis.isDefault) && data.axisConfigs.length > 0) {
    data.axisConfigs = data.axisConfigs.map((axis, index) => ({ ...axis, isDefault: index === 0 }))
  }

  return { ...bundle, data }
}

/** 结构自检：引用完整性（悬空外键会导致 UI 出现"幽灵条目"且无法通过删除入口清理） */
function validateReferences(bundle: ExportBundle): ImportIssue[] {
  const issues: ImportIssue[] = []
  const planIds = new Set(bundle.data.plans.map((plan) => plan.id))
  const axisIds = new Set(bundle.data.axisConfigs.map((axis) => axis.id))
  const taskIds = new Set(bundle.data.tasks.map((task) => task.id))

  for (const task of bundle.data.tasks) {
    if ((task.deletedAt ?? 0) > 0) continue
    if (!planIds.has(task.planId)) {
      issues.push({ path: `tasks[${task.id}].planId`, message: `引用了不存在的计划 ${task.planId}` })
    }
    if (task.parentId !== undefined && !taskIds.has(task.parentId)) {
      issues.push({ path: `tasks[${task.id}].parentId`, message: `引用了不存在的父任务 ${task.parentId}` })
    }
  }
  for (const todo of bundle.data.todos) {
    if (!axisIds.has(todo.axisConfigId)) {
      issues.push({
        path: `todos[${todo.id}].axisConfigId`,
        message: `引用了不存在的轴配置 ${todo.axisConfigId}`,
      })
    }
  }
  // 执行与复盘是历史资料；关联对象可能已从回收站永久清理。
  // 保留原 ID 和正文，不因历史关联缺失而拒绝有效备份。

  return issues
}

/** 导入入口。整体拒绝或整体写入，绝不部分导入 */
export async function importBundle(database: CadenceDatabase, raw: unknown, duplicatePolicy: 'skip' | 'replace' = 'skip'): Promise<ImportResult> {
  // 1) 结构校验（含 format 字段）
  const parsed = ExportBundleSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'bad_format',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    }
  }

  // 2) 版本检查：高于当前版本的数据我们无法理解其结构，直接拒绝
  //    （低于当前版本可以走迁移；v1 暂无历史版本）
  if (parsed.data.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'version_too_new' }
  }

  // 3) 归一化
  const bundle = normalizeBundle(parsed.data)
  for (const table of BUSINESS_TABLES) {
    const ids = (bundle.data[table] as unknown as Record<string, unknown>[]).map(row => row[table === 'settings' ? 'key' : 'id'])
    if (new Set(ids).size !== ids.length) return { ok: false, reason: 'invalid_data', issues: [{ path: table, message: '备份内存在重复记录编号' }] }
  }

  // 4) 引用完整性
  const referenceIssues = validateReferences(bundle)
  if (referenceIssues.length > 0) {
    return { ok: false, reason: 'invalid_data', issues: referenceIssues }
  }

  // 5) 单事务写入，失败整体回滚
  const stats = {} as Record<BusinessTableName, number>
  try {
    await database.transaction('rw', [...BUSINESS_TABLES, 'snapshots'], async () => {
      const backup = await buildExportBundle(database, 'blog-cadence-1', Date.now())
      const merged = structuredClone(backup)
      const writes = new Map<BusinessTableName, unknown[]>()
      for (const name of BUSINESS_TABLES) {
        const keyOf = (row: unknown): string => String((row as Record<string, unknown>)[name === 'settings' ? 'key' : 'id'])
        const existing = new Map< string, unknown >((backup.data[name] as unknown[]).map(row => [keyOf(row), row]))
        const incoming = (bundle.data[name] as unknown[]).filter(row => duplicatePolicy === 'replace' || !existing.has(keyOf(row)))
        for (const row of incoming) existing.set(keyOf(row), row)
        ;(merged.data as unknown as Record<string, unknown[]>)[name] = [...existing.values()]
        writes.set(name, incoming)
        stats[name] = incoming.length
      }
      const issues = validateReferences(merged)
      if (issues.length) throw new Error(issues[0]?.message)
      // 导入与同步共用业务约束，校验最终合并结果后再写入。
      validateCadenceSnapshot(BUSINESS_TABLES.flatMap(table => (merged.data[table] as unknown as Record<string, unknown>[]).map(payload => ({ key: `${table}:${payload.id ?? payload.key}`, table, recordId: String(payload.id ?? payload.key), payload, revision: '' }))))
      await database.snapshots.put({ id: generateId('before-import', Date.now()), createdAt: Date.now(), reason: 'manual', payload: JSON.stringify(backup) })
      for (const name of BUSINESS_TABLES) {
        const rows = writes.get(name) ?? []
        if (rows.length) await database.table(name).bulkPut(rows)
      }
    })
  } catch {
    return { ok: false, reason: 'write_failed' }
  }

  return { ok: true, stats }
}

/** 生成新实体的 id（导入时若包内缺 id 则用它补齐） */
export function generateId(prefix: string, now: number): string {
  return newEntityId(prefix, now)
}

/** 供类型检查用的窄化工具（导出包内的状态枚举） */
export const PLAN_STATUSES: readonly PlanStatus[] = ['active', 'paused', 'completed', 'archived']
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done', 'blocked']
export const TODO_STATUSES: readonly TodoStatus[] = ['open', 'doing', 'done', 'archived']
