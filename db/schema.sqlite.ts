/**
 * SQLite（开发环境）文章表定义 —— Drizzle sqlite-core
 *
 * 与 `schema.pg.ts` 保持同一字段集合，仅方言实现不同：
 * - `tags` 存 JSON 文本；`type` 用 check 约束（SQLite 无 enum）。
 * - 时间戳用 `integer(timestamp_ms)`，读写均映射 `Date`。
 * - `$defaultFn` 在客户端（Node）生成时间，保证与 PG 的 defaultNow 语义一致。
 */
import { sqliteTable, text, integer, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/** articles 表（SQLite 方言） */
export const articles = sqliteTable(
  'articles',
  {
    /** UUID 主键（由应用层 crypto.randomUUID() 生成） */
    id: text('id').primaryKey(),
    /** 标题 */
    title: text('title').notNull(),
    /** 唯一 URL 标识 */
    slug: text('slug').notNull().unique(),
    /** MDX 源码 */
    content: text('content').notNull().default(''),
    /** 文章类型 tech|note|photo（check 约束兜底） */
    type: text('type').notNull().default('tech'),
    /** 摘要 */
    summary: text('summary').notNull().default(''),
    /** 标签：JSON 编码的 string[] */
    tags: text('tags').notNull().default('[]'),
    /** 创建时间（epoch 毫秒） */
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    /** 更新时间（epoch 毫秒） */
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // 数据完整性：type 仅允许三种取值
    check('articles_type_check', sql`${table.type} in ('tech', 'note', 'photo')`),
  ],
);

/** 行类型（插入用） */
export type NewArticle = typeof articles.$inferInsert;
/** 行类型（查询用） */
export type ArticleRow = typeof articles.$inferSelect;
