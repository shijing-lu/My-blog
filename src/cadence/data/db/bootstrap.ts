/**
 * 首次启动引导（bootstrap）
 *
 * 只做一件事：保证"默认轴配置"存在。
 * 复盘周期配置不在这里创建 —— 没有数据的空周期列表是正常初始态，
 * 让用户自己建第一条复盘周期，比塞一条示例数据更符合"工具不是玩具"的定位。
 */

import { defaultAxisConfig } from '@/cadence/entities/axis'
import type { CadenceDatabase } from './database'
import { db } from './database'

/** 已初始化标记的 settings 键 */
const BOOTSTRAP_KEY = 'bootstrap.version'

/**
 * 启动引导入口（供 main.tsx **动态** import）
 *
 * 调用方通过 `await import('@/cadence/data/db/bootstrap')` 引用本文件，
 * 于是"本文件 → ./database → Dexie"整条依赖图落进异步 chunk，
 * 不会出现在首屏的静态依赖里 —— 用户打开应用只是看一眼总览时，
 * 不该先下载 30KB 的数据库运行时。
 */
export async function bootstrapAtStartup(now: number): Promise<void> {
  await bootstrapDatabase(db, now)
}

/**
 * 幂等初始化：可安全地在每次启动时调用
 *
 * 为什么靠标记而不是靠"查表是否为空"：
 *   用户删光自己的轴配置后重开应用，不应被塞回一条默认配置 ——
 *   "查表为空"会把这种自主行为误解为"首次启动"。
 */
export async function bootstrapDatabase(database: CadenceDatabase, now: number): Promise<void> {
  const marker = await database.settings.get(BOOTSTRAP_KEY)
  if (marker !== undefined) return

  await database.transaction('rw', ['axisConfigs', 'settings'], async () => {
    const hasDefault = (await database.axisConfigs.toArray()).filter((axis) => axis.isDefault).length
    if (hasDefault === 0) {
      // 若库里有轴配置但没有默认项，把第一个设为默认而不是再插一条
      const existing = await database.axisConfigs.toArray()
      if (existing.length === 0) {
        await database.axisConfigs.put(defaultAxisConfig(now))
      } else {
        await database.axisConfigs.update(existing[0]!.id, { isDefault: true })
      }
    }
    await database.settings.put({ key: BOOTSTRAP_KEY, value: 1, updatedAt: now })
  })
}
