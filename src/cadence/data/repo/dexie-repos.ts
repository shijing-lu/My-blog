/**
 * Dexie 适配器 —— Repository 接口的 Web 实现
 * ---------------------------------------------------------------------------
 * 索引对齐（02-技术架构文档 §4.1）：每个 where() 都必须命中 schema.ts 里声明的索引。
 * 若你需要一个新查询条件，**先去 schema.ts 加索引，再回来写查询**，
 * 否则会静默退化为全表扫描。
 */

import Dexie, { type EntityTable } from 'dexie'
import type { Session } from '@/cadence/entities/session'
import type { Task } from '@/cadence/entities/task'
import type { Todo } from '@/cadence/entities/todo'
import type { CadenceDatabase } from '@/cadence/data/db/database'
import { NOT_DELETED } from '@/cadence/shared/model/entity'
import type { EntityCore, HasId, SoftDeleteRepository, SoftDeletableId } from './types'

/**
 * 主键类型收敛
 *
 * Dexie 对泛型实体的主键推导（IDType<T,'id'>）在泛型参数未定型时无法解析，
 * 导致 `get(id: string)` 这类调用报类型不匹配。本项目主键恒为 string，
 * 这里集中做一次断言（运行时传入的就是这个 string），调用处保持干净。
 * `as unknown as never` 是因为 never 可赋值给任何类型参数位 —— 仅此一处，有注释。
 */
function key(id: string): never {
  return id as unknown as never
}

/**
 * 基础仓储（无软删除）：执行记录这类纯历史数据使用
 */
export class DexieEntityRepo<T extends HasId> implements EntityCore<T> {  constructor(
    protected readonly database: CadenceDatabase,
    protected readonly table: EntityTable<T, 'id'>,
  ) {}

  async get(id: string): Promise<T | undefined> {
    return this.table.get(key(id))
  }

  async put(entity: T, now: number): Promise<T> {
    const existing = await this.table.get(key(entity.id))
    const next: T = {
      ...entity,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await this.table.put(next)
    return next
  }

  async purge(id: string): Promise<void> {
    await this.table.delete(key(id))
  }
}

/**
 * 软删除仓储：计划 / 任务 / 待办 / 复盘配置使用
 *
 * 命中索引的约定（见 shared/model/entity.ts）：
 *   list()      → where('deletedAt').equals(0)
 *   listTrash() → where('deletedAt').above(0)
 */
export class DexieSoftDeleteRepo<T extends SoftDeletableId>
  extends DexieEntityRepo<T>
  implements SoftDeleteRepository<T>
{
  constructor(
    database: CadenceDatabase,
    table: EntityTable<T, 'id'>,
    /** 软删除时的级联动作（子类按需传入，如"删任务级联删子任务"） */
    protected readonly cascade?: (id: string, now: number) => Promise<void>,
  ) {
    super(database, table)
  }

  async list(): Promise<T[]> {
    return this.table.where('deletedAt').equals(NOT_DELETED).toArray()
  }

  async listTrash(): Promise<T[]> {
    // above(0) 同样命中索引 —— 回收站查询不需要全表扫描
    const rows = await this.table.where('deletedAt').above(NOT_DELETED).toArray()
    return rows.sort((a, b) => b.deletedAt - a.deletedAt)
  }

  override async put(entity: T, now: number): Promise<T> {
    const existing = await this.table.get(key(entity.id))
    const next: T = {
      ...entity,
      // 调用方可以不关心软删除字段；落库前统一补哨兵，
      // 否则缺失字段的记录不会进入索引，会被 list() 静默吞掉
      deletedAt: entity.deletedAt ?? NOT_DELETED,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await this.table.put(next)
    return next
  }

  async softDelete(id: string, now: number): Promise<void> {
    // UpdateSpec<InsertType<T,'id'>> 在泛型下无法解析，这里同样收敛为 never；
    // 更新逻辑的正确性由 repo.test.ts 全量覆盖（时间戳、级联、恢复）
    await this.table.update(key(id), { deletedAt: now, updatedAt: now } as unknown as never)
    if (this.cascade) await this.cascade(id, now)
  }

  async restore(id: string, now: number): Promise<void> {
    await this.table.update(key(id), { deletedAt: NOT_DELETED, updatedAt: now } as unknown as never)
  }

  async count(): Promise<number> {
    return this.table.where('deletedAt').equals(NOT_DELETED).count()
  }
}

/** 待办仓储：XY 视图与"即将到期"查询 */
export class DexieTodoRepo extends DexieSoftDeleteRepo<Todo> {
  constructor(database: CadenceDatabase) {
    super(database, database.todos)
  }

  /**
   * 未完成且即将到期 —— 命中 [status+dueAt] 复合索引
   *
   * status 是枚举而不是区间，所以 open / doing 各查一次再合并；
   * between 的下界用 Dexie.minKey 表示"dueAt 任意"。
   */
  async dueWithin(now: number, withinMs: number): Promise<Todo[]> {
    const limit = now + withinMs
    const open = await this.table
      .where('[status+dueAt]')
      .between(['open', Dexie.minKey], ['open', limit])
      .toArray()
    const doing = await this.table
      .where('[status+dueAt]')
      .between(['doing', Dexie.minKey], ['doing', limit])
      .toArray()

    // dueAt 为空的记录在复合索引里排在最前（undefined 参与索引排序），
    // 因此这里再过滤一次，避免把"无截止"的待办误报为"即将到期"
    return [...open, ...doing].filter((todo) => todo.dueAt !== undefined && todo.dueAt >= now)
  }

  /** 某轴配置下的待办 —— 命中 axisConfigId 索引 */
  async byAxis(axisConfigId: string): Promise<Todo[]> {
    return this.table.where('axisConfigId').equals(axisConfigId).toArray()
  }
}

/** 任务仓储：按计划分组 + 级联软删除子任务 */
export class DexieTaskRepo extends DexieSoftDeleteRepo<Task> {
  constructor(database: CadenceDatabase) {
    super(database, database.tasks, async (id, now) => {
      // 这里按 parentId 查，走的是 parentId 索引（不是 [planId+status]）
      await database.tasks.where('parentId').equals(id).modify({ deletedAt: now, updatedAt: now })
    })
  }

  /** 计划下的任务，按 order 升序 —— 命中 planId 索引 */
  async byPlan(planId: string): Promise<Task[]> {
    return this.table.where('planId').equals(planId).sortBy('order')
  }
}

/** 执行记录仓储：区间查询 */
export class DexieSessionRepo extends DexieEntityRepo<Session> {
  constructor(database: CadenceDatabase) {
    super(database, database.sessions)
  }

  /**
   * 与 [from, to] 相交的记录
   *
   * 相交条件是 startedAt < to && (endedAt ?? +∞) > from。
   * 复合索引 [startedAt+endedAt] 只能高效回答"startedAt 落在某区间"，
   * 因此用 startedAt >= from - 24h 做粗筛，再在内存里精筛。
   * 24h 是"单条执行记录的最长合理时长"：超过它属于数据异常，
   * 宁可漏掉异常数据也不做全表扫描。
   */
  async inRange(from: number, to: number): Promise<Session[]> {
    const candidates = await this.table.where('startedAt').below(to).toArray()
    return candidates.filter(
      (session) =>
        session.startedAt < to && (session.endedAt ?? Number.POSITIVE_INFINITY) > from,
    )
  }
}
