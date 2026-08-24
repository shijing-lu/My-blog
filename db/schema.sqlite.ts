/**
 * SQLite（开发环境）文章表定义 —— Drizzle sqlite-core
 *
 * 与 `schema.pg.ts` 保持同一字段集合，仅方言实现不同：
 * - `tags` 存 JSON 文本；`type` 用 check 约束（SQLite 无 enum）。
 * - 时间戳用 `integer(timestamp_ms)`，读写均映射 `Date`。
 * - `$defaultFn` 在客户端（Node）生成时间，保证与 PG 的 defaultNow 语义一致。
 */
import { sqliteTable, text, integer, check, customType, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { isPostgres } from './dialect';

/**
 * 双方言时间戳列：读写映射 Date，存储按方言区分
 * - SQLite：毫秒整数（integer）
 * - PostgreSQL：ISO 字符串（PG timestamp 列接受 ISO；postgres.js 驱动对
 *   number 参数会抛 ERR_INVALID_ARG_TYPE，故必须给字符串）
 */
const timestampMs = customType<{ data: Date; driverData: string | number | Date }>({
  dataType() {
    return 'integer';
  },
  toDriver(value: Date) {
    return isPostgres ? value.toISOString() : value.getTime();
  },
  fromDriver(value: string | number | Date) {
    return value instanceof Date ? value : new Date(value);
  },
});

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
    /** 手动指定的封面图 URL（可空；为空时首页回落到正文首图） */
    cover: text('cover'),
    /** 标签：JSON 编码的 string[] */
    tags: text('tags').notNull().default('[]'),
    /** 创建时间（epoch 毫秒） */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    /** 更新时间（epoch 毫秒） */
    updatedAt: timestampMs('updated_at')
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

/** 图片表：编辑器上传的本地图片（DB 持久化，兼容 Vercel 无本地磁盘） */
export const images = sqliteTable('images', {
  /** UUID 主键 */
  id: text('id').primaryKey(),
  /** MIME 类型（仅允许 image/* 白名单） */
  mime: text('mime').notNull(),
  /** 图片二进制 */
  data: text('data').notNull(), // base64 编码的图片二进制
  /** 创建时间 */
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 相册照片表（影集子系统，独立于博客文章） */
export const photos = sqliteTable('photos', {
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
  takenAt: timestampMs('taken_at').notNull(),
  /** 上传时间 */
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 站点设置 KV 表（如首页 Hero 诗词轮播配置） */
export const settings = sqliteTable('settings', {
  /** 配置键 */
  key: text('key').primaryKey(),
  /** JSON 值 */
  value: text('value').notNull(),
  /** 更新时间 */
  updatedAt: timestampMs('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 日历：待办（私密，仅管理员） */
export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  /** 所属日期 YYYY-MM-DD */
  date: text('date').notNull(),
  /** 待办内容 */
  text: text('text').notNull(),
  /** 是否完成 */
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 日历：日记（私密，仅管理员，一人一天一篇） */
export const diaryEntries = sqliteTable('diary_entries', {
  id: text('id').primaryKey(),
  /** 日记日期 YYYY-MM-DD（唯一，一天一篇） */
  date: text('date').notNull().unique(),
  /** 标题 */
  title: text('title').notNull().default(''),
  /** Markdown 正文 */
  content: text('content').notNull().default(''),
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestampMs('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 日历：重要日期（公开显示，可每年重复，可农历） */
export const calendarEvents = sqliteTable('calendar_events', {
  id: text('id').primaryKey(),
  /** 事件标题 */
  title: text('title').notNull(),
  /** 阳历日期 YYYY-MM-DD（lunar 为 false 时使用） */
  date: text('date').notNull(),
  /** 是否每年重复（生日/纪念日） */
  repeat: integer('repeat', { mode: 'boolean' }).notNull().default(false),
  /** 是否农历日期（如农历生日） */
  lunar: integer('lunar', { mode: 'boolean' }).notNull().default(false),
  /** 农历月日："MM-DD"（如 08-15），闰月用 "-MM-DD" 前缀负号 */
  lunarDate: text('lunar_date'),
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 动态（动态圈，公开浏览；评论/点赞预留，后续独立表） */
export const moments = sqliteTable('moments', {
  id: text('id').primaryKey(),
  /** 文字内容（可为空，但需有媒体） */
  content: text('content').notNull().default(''),
  /** 媒体 JSON：[{type:'image'|'gif'|'video', url, poster?}] */
  media: text('media').notNull().default('[]'),
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestampMs('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 点赞（文章/动态通用；GitHub 登录与匿名分开计数，可取消） */
export const likes = sqliteTable(
  'likes',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 目标类型：article | moment */
    targetType: text('target_type').notNull(),
    /** 目标 id（文章 id 或动态 id） */
    targetId: text('target_id').notNull(),
    /** 点赞者类型：anonymous | github */
    userType: text('user_type').notNull().default('anonymous'),
    /** 身份标识：匿名 = 浏览器指纹；GitHub = token 哈希（不存明文） */
    userIdent: text('user_ident').notNull().default(''),
    /** 点赞时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // 同一目标 + 同类型 + 同一身份仅一条 → toggle 天然幂等（赞/取消）
    unique('likes_target_user_unique').on(table.targetType, table.targetId, table.userType, table.userIdent),
  ],
);

/** GitHub 登录用户（评论/点赞身份，信息缓存自 GitHub API） */
export const githubUsers = sqliteTable('github_users', {
  /** UUID 主键 */
  id: text('id').primaryKey(),
  /** GitHub 用户 ID（唯一） */
  githubId: integer('github_id').notNull().unique(),
  /** GitHub 用户名 */
  login: text('login').notNull(),
  /** 显示昵称（GitHub name，可能为空） */
  name: text('name').notNull().default(''),
  /** 头像 URL */
  avatarUrl: text('avatar_url').notNull().default(''),
  /** 首次登录时间 */
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 评论（文章/动态通用，支持嵌套回复；作者可为匿名或 GitHub 登录） */
export const comments = sqliteTable(
  'comments',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 目标类型：article | moment */
    targetType: text('target_type').notNull(),
    /** 目标 id（文章 id 或动态 id） */
    targetId: text('target_id').notNull(),
    /** 回复的父评论 id（null = 顶级评论） */
    parentId: text('parent_id'),
    /** 评论内容（纯文本，前端转义） */
    content: text('content').notNull().default(''),
    /** 作者类型：anonymous | github */
    authorType: text('author_type').notNull().default('anonymous'),
    /** 匿名昵称（GitHub 作者为空） */
    authorName: text('author_name').notNull().default(''),
    /** GitHub 用户（本站 id，可空） */
    githubUserId: text('github_user_id'),
    /** 点赞数（冗余计数，"最热"排序用；点赞去重由 likes 表保证） */
    likeCount: integer('like_count').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // 按目标取评论（分页/排序）
    index('comments_target_idx').on(table.targetType, table.targetId, table.createdAt),
    // 按父评论取回复
    index('comments_parent_idx').on(table.parentId),
  ],
);

/** 自定义字体（管理员本地导入；与 images 同模式，DB 存 base64） */
export const fonts = sqliteTable('fonts', {
  /** UUID 主键 */
  id: text('id').primaryKey(),
  /** 字体族名（用户填，@font-face 的 font-family） */
  familyName: text('family_name').notNull(),
  /** MIME（font/woff2 等） */
  mime: text('mime').notNull(),
  /** 字体二进制（base64） */
  data: text('data').notNull(),
  /** 字节数 */
  size: integer('size').notNull().default(0),
  /** 上传时间 */
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});
