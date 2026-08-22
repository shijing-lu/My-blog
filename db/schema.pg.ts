/**
 * PostgreSQL（生产环境）文章表定义 —— Drizzle pg-core
 *
 * 与 `schema.sqlite.ts` 保持同一字段集合，仅方言实现不同：
 * - `tags` 用 jsonb；`type` 用 check 约束（PG 无 enum 需额外迁移）。
 * - 时间戳用 `timestamp withTimezone`，读写均映射 `Date`。
 */
import { pgTable, text, timestamp, jsonb, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** articles 表（PostgreSQL 方言） */
export const articles = pgTable(
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
    /** 手动指定的封面图 URL（可空；为空时首页回落到正文首图） */
    cover: text('cover'),
    /** 标签：jsonb 数组（应用层以 JSON 字符串写入，PG 自动解析） */
    tags: jsonb('tags').notNull().default([]),
    /** 创建时间 */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** 更新时间 */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
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

/** 图片表：编辑器上传的本地图片（DB 持久化，兼容 Vercel 无本地磁盘） */
export const images = pgTable('images', {
  /** UUID 主键 */
  id: text('id').primaryKey(),
  /** MIME 类型（仅允许 image/* 白名单） */
  mime: text('mime').notNull(),
  /** 图片二进制 */
  data: text('data').notNull(), // base64 编码的图片二进制
  /** 创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/** 相册照片表（影集子系统，独立于博客文章） */
export const photos = pgTable('photos', {
  /** UUID 主键 */
  id: text('id').primaryKey(),
  /** 原图 URL（Vercel Blob 或外部图床 URL） */
  url: text('url').notNull(),
  /** 缩略图 URL（为空时前端用原图） */
  thumbUrl: text('thumb_url'),
  /** 可选标题 */
  title: text('title').notNull().default(''),
  /** 原图宽度（瀑布流占位防 CLS；URL 导入失败时可空） */
  width: integer('width'),
  /** 原图高度 */
  height: integer('height'),
  /** 展示日期（用户可自定义，默认当日；时间线按此排序） */
  takenAt: timestamp('taken_at', { withTimezone: true, mode: 'date' }).notNull(),
  /** 上传时间 */
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});
