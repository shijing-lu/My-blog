/**
 * 回收站基础设施（软删除统一处理）
 * 依据：01-需求文档 FR-PLAN-01 / FR-TODO-01 / FR-SYS-06；§352 关键决策 4
 *
 * 保留 30 天的策略落在这里，而不是散落在各页面的"清空回收站"按钮里 ——
 * 口径一致才不会被某个入口悄悄改掉。
 */

import type { CadenceDatabase } from '@/cadence/data/db/database'
import { BUSINESS_TABLES } from '@/cadence/data/db/schema'
import { NOT_DELETED } from '@/cadence/shared/model/entity'

/** 回收站保留期（毫秒）。30 天是需求文档的硬性约定 */
export const TRASH_RETENTION_MS = 30 * 86_400_000

/**
 * 彻底删除"在回收站中超过了保留期"的记录
 *
 * @returns 被彻底删除的总行数（供"存储占用"页展示）
 *
 * 设计说明：逐表扫描后过滤，而不是为每个实体写一条复合索引。
 * 该操作只在应用启动与用户手动清空时运行，频率极低，
 * 用一点扫描成本换取索引精简是划算的。
 */
export async function purgeExpiredTrash(database: CadenceDatabase, now: number): Promise<number> {
  let purged = 0

  await database.transaction('rw', BUSINESS_TABLES, async () => {
    for (const name of BUSINESS_TABLES) {
      if (name === 'settings' || name === 'axisConfigs' || name === 'dailyPlans' || name === 'scheduleEvents') continue // 设置与轴配置无软删除语义
      const table = database.table(name)
      const rows = (await table.toArray()) as Array<{ id?: string; deletedAt?: number }>
      // deletedAt > 0 才是"在回收站里"；0（哨兵）与缺失都视为未删除
      const expired = rows.filter((row) => (row.deletedAt ?? 0) > NOT_DELETED && now - row.deletedAt! > TRASH_RETENTION_MS)
      if (expired.length === 0) continue
      const ids = expired.map((row) => row.id).filter((id): id is string => typeof id === 'string')
      await table.bulkDelete(ids)
      purged += ids.length
    }
  })

  return purged
}

/** 清空整个回收站（用户手动触发，需在 UI 上二次确认） */
export async function emptyTrash(database: CadenceDatabase): Promise<number> {
  let purged = 0

  await database.transaction('rw', BUSINESS_TABLES, async () => {
    for (const name of BUSINESS_TABLES) {
      if (name === 'settings' || name === 'axisConfigs' || name === 'dailyPlans' || name === 'scheduleEvents') continue
      const table = database.table(name)
      const rows = (await table.toArray()) as Array<{ id?: string; deletedAt?: number }>
      const deleted = rows.filter((row) => (row.deletedAt ?? 0) > NOT_DELETED)
      const ids = deleted.map((row) => row.id).filter((id): id is string => typeof id === 'string')
      await table.bulkDelete(ids)
      purged += ids.length
    }
  })

  return purged
}

/** 回收站统计（"存储占用"页展示） */
export async function trashStats(database: CadenceDatabase): Promise<Record<string, number>> {
  const stats: Record<string, number> = {}
  for (const name of BUSINESS_TABLES) {
    if (name === 'settings' || name === 'axisConfigs' || name === 'dailyPlans' || name === 'scheduleEvents') continue
    const rows = (await database.table(name).toArray()) as Array<{ deletedAt?: number }>
    const count = rows.filter((row) => (row.deletedAt ?? 0) > NOT_DELETED).length
    if (count > 0) stats[name] = count
  }
  return stats
}
