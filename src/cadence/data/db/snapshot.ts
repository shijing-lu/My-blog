/**
 * 迁移前快照
 * 依据：02-技术架构文档 §4.2 纪律 2
 *
 * 为什么必须有这一道保险：
 *   迁移代码是"只跑一次的代码"——绝大多数用户只在升级时执行一次，
 *   意味着它的 bug 几乎不可能在发布前被真实数据暴露。
 *   快照让"迁移写坏数据"从不可恢复变成可恢复。
 *
 * 存在 IndexedDB 而不是 localStorage：
 *   全量数据轻松超过 localStorage 的 5MB 配额；IndexedDB 没有这个问题。
 */

import type { CadenceDatabase } from './database'
import { buildExportBundle } from './export'

/** 最多保留的快照份数。快照是全量数据，无限保留会翻倍存储占用 */
export const MAX_SNAPSHOTS = 3

/**
 * 创建一次快照
 *
 * @returns 快照 id（升级流程中若失败，可提示用户此 id）
 */
export async function createSnapshot(
  database: CadenceDatabase,
  reason: 'upgrade' | 'manual',
  now: number,
  appVersion: string,
): Promise<string> {
  const bundle = await buildExportBundle(database, appVersion, now)
  const id = `snap_${now.toString(36)}_${Math.floor(now % 100000).toString(36)}`

  await database.snapshots.put({
    id,
    createdAt: now,
    reason,
    payload: JSON.stringify(bundle),
  })

  await pruneSnapshots(database, MAX_SNAPSHOTS)
  return id
}

/** 只保留最近 N 份快照 */
export async function pruneSnapshots(database: CadenceDatabase, keep: number = MAX_SNAPSHOTS): Promise<number> {
  const all = await database.snapshots.orderBy('createdAt').toArray()
  if (all.length <= keep) return 0
  const stale = all.slice(0, all.length - keep)
  await database.snapshots.bulkDelete(stale.map((row) => row.id))
  return stale.length
}

/** 快照列表（"数据管理"页展示） */
export async function listSnapshots(database: CadenceDatabase) {
  const rows = await database.snapshots.orderBy('createdAt').toArray()
  return rows
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      reason: row.reason,
      bytes: row.payload.length,
    }))
    .reverse()
}

/** 从快照恢复（把 payload 重新导入）—— 走与用户导入完全相同的校验链 */
export async function restoreSnapshot(database: CadenceDatabase, id: string): Promise<boolean> {
  const row = await database.snapshots.get(id)
  if (!row) return false

  const { importBundle } = await import('./export')
  const result = await importBundle(database, JSON.parse(row.payload))
  return result.ok
}
