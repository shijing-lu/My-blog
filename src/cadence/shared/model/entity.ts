/**
 * 通用实体契约（横切，无业务语义）
 * ---------------------------------------------------------------------------
 * 放在 shared 而不是 entities 的原因：
 *   这些是**所有**持久化实体共有的字段约定，不属于任何一个业务切片。
 *   若放在 `entities/common`，同层的其他实体引用它就会被分层规则拦截
 *   （切片之间禁止运行时互引）—— 而它显然不是切片。
 *
 * 为什么软删除用 `deletedAt` 而不是 `deleted: boolean`：
 *   1. 一个字段同时回答"是否已删除"和"何时删除"两件事，
 *      回收站的"保留 30 天"策略直接按时间过滤，不需要额外字段。
 *   2. 可索引：`deletedAt` 出现在 Dexie 索引里，
 *      `where('deletedAt').equals(undefined)` 就是"未删除"查询，命中索引。
 *
 * 为什么所有可选字段都写成 `?: T | undefined`：
 *   tsconfig 开了 exactOptionalPropertyTypes —— 此时 `?: T` 表示"可以缺省"，
 *   但不允许显式赋 undefined。实体对象会在 Zod 解析、Dexie 读写、
 *   展开运算符之间流转，显式允许 undefined 能避免大量无意义的条件展开。
 */

/**
 * "未删除"哨兵值
 *
 * ⚠️ 为什么不用 undefined / null（实测踩坑）：
 *   IndexedDB 的索引**不能**包含 undefined 或 null 键 —— 缺失该字段的记录
 *   根本不会出现在索引里，因此 `where('deletedAt').equals(undefined)`
 *   在运行时直接抛 "Invalid key provided"（类型层面还查不出来，
 *   因为 Dexie 的类型定义与运行时校验不一致）。
 *
 *   用 0 作哨兵后，两个方向的查询都能命中索引：
 *     未删除   → where('deletedAt').equals(0)
 *     回收站   → where('deletedAt').above(0)
 */
export const NOT_DELETED = 0;

/** 软删除：0 = 未删除；> 0 = 删除时间（UTC ms） */
export interface SoftDeletable {
  deletedAt: number;
}

/** 是否已删除（进回收站） */
export function isDeleted(entity: { deletedAt: number }): boolean {
  return entity.deletedAt > NOT_DELETED;
}

/** 创建与更新时间。updatedAt 由 Repository 统一维护，调用方不需要手动赋值 */
export interface Timestamped {
  createdAt: number;
  updatedAt: number;
}

/** 带标签的实体（计划 / 任务 / 待办 / 复盘条目） */
export interface Taggable {
  /** 标签不建表：数量少、无独立属性、总是随实体一起读写，单独建表只会增加复杂度 */
  tags: string[];
}

/** 新建实体时的基础字段（不含 id 与业务字段） */
export type EntityMeta = SoftDeletable & Timestamped & Partial<Taggable>;

/**
 * 生成实体 id：时间戳 + 随机段的组合，保证客户端离线生成的唯一性
 *
 * 随机段用 crypto.getRandomValues 而不是 Math.random()（红线 C6）。
 * 两者在这里的差别不在"质量"（id 唯一性不需要密码学强度），
 * 而在于可测性：禁用 Math.random 让"任意测试数据都可复现"成为全库纪律，
 * 不需要为 id 生成单独开例外。
 */
let idSeq = 0;

export function newEntityId(prefix: string, now: number): string {
  idSeq = (idSeq + 1) % 0x10000;
  let random = idSeq.toString(36);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    random = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${prefix}_${now.toString(36)}_${random}`;
}
