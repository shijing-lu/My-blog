/**
 * 数据库实例工厂
 * ---------------------------------------------------------------------------
 * 为什么是工厂而不是直接导出单例：
 *   迁移与往返测试需要**全新且隔离**的数据库实例（每个用例独立、可重复）。
 *   单例在测试里是灾难 —— 用例之间会互相污染，且无法对"从零建库"做断言。
 *   生产代码用模块底部的 `db` 单例，测试用 `createDatabase(唯一名字)`。
 */

import Dexie from 'dexie'

import { BUSINESS_TABLES, DATABASE_NAME, SCHEMA_V1, SCHEMA_VERSION, type CadenceDatabase } from './schema'

export type { CadenceDatabase }

/** 创建一个数据库实例并注册全部 Schema 版本 */
export function createDatabase(name: string = DATABASE_NAME): CadenceDatabase {
  const database = new Dexie(name) as CadenceDatabase

  database.version(SCHEMA_VERSION).stores(SCHEMA_V1)
  // 本地版本 2 增加同步状态；业务导出格式仍为 schemaVersion 1。
  database.version(2).stores({ ...SCHEMA_V1, _syncBase: 'key', _syncConflicts: 'key', _syncPending: 'id' })

  // 以后的版本在这里追加：
  // database.version(2).stores({...}).upgrade(async (tx) => { ... })

  return database
}

/** 生产环境单例。模块加载即发起 open（幂等）——
 * 若只依赖 bootstrap 的异步调用，"冷启动立刻切页"时 useLiveQuery 的首次订阅
 * 会与 open() 竞争，失败被静默吞掉后数据永远不来（表现为页面空白、刷新才恢复）。
 * Dexie 的 open 幂等，提前调用没有代价；bootstrap 里的引导写入照常在 open 后执行。 */
export const db = createDatabase()
void db.open().catch((error: unknown) => {
  console.warn('[cadence] 数据库打开失败，应用将以无持久化状态运行：', error)
})

/** 业务表引用（导入导出 / 快照 / 回收站遍历用） */
export function businessTables(database: CadenceDatabase) {
  return BUSINESS_TABLES.map((name) => {
    const table = database.table(name)
    return { name, table }
  })
}
