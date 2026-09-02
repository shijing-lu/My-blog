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

/** 图片表：编辑器上传的本地图片（R2 对象存储；过渡期兼容 base64 存 data） */
export const images = sqliteTable('images', {
  /** UUID 主键 */
  id: text('id').primaryKey(),
  /** MIME 类型（仅允许 image/* 白名单） */
  mime: text('mime').notNull(),
  /** 图片二进制（base64；迁移后为空，新图不入库） */
  data: text('data').notNull().default(''), // base64 编码的图片二进制（兼容旧数据）
  /** R2 对象 key（原图） */
  key: text('key'),
  /** R2 原图公开 URL */
  url: text('url'),
  /** R2 缩略图对象 key */
  thumbKey: text('thumb_key'),
  /** R2 缩略图公开 URL */
  thumbUrl: text('thumb_url'),
  /** 原图宽度 */
  width: integer('width'),
  /** 原图高度 */
  height: integer('height'),
  /** 字节数 */
  size: integer('size'),
  /** 创建时间 */
  createdAt: timestampMs('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 相册照片表（影集子系统，独立于博客文章） */
export const photos = sqliteTable('photos', {
  /** UUID 主键 */
  id: text('id').primaryKey(),
  /** 原图 URL（R2 或外部图床 URL） */
  url: text('url').notNull(),
  /** R2 原图对象 key */
  key: text('key'),
  /** 缩略图 URL（为空时前端用原图） */
  thumbUrl: text('thumb_url'),
  /** R2 缩略图对象 key */
  thumbKey: text('thumb_key'),
  /** 可选标题 */
  title: text('title').notNull().default(''),
  /** 标签：JSON 编码的 string[]（上传时设置，影集页可按标签过滤） */
  tags: text('tags').notNull().default('[]'),
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
  /** 标签：JSON 编码的 string[]（便于搜索/筛选/时间线归类） */
  tags: text('tags').notNull().default('[]'),
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

/** 思维导图（绑定文章或独立；data 为 simple-mind-map 全量 JSON） */
export const mindmaps = sqliteTable(
  'mindmaps',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 导图标题 */
    title: text('title').notNull(),
    /** 绑定文章 id（null = 独立导图） */
    articleId: text('article_id'),
    /** simple-mind-map 全量数据 JSON（layout/root/theme/view + 节点锚点） */
    data: text('data').notNull(),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    /** 更新时间 */
    updatedAt: timestampMs('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // 按文章查导图
    index('mindmaps_article_idx').on(table.articleId),
  ],
);

/** 网址导航·分类 */
export const webCategories = sqliteTable(
  'web_categories',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 分类名 */
    name: text('name').notNull(),
    /** 分类图标（emoji/文字，可空） */
    icon: text('icon'),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('web_categories_sort_idx').on(table.sort),
  ],
);

/**
 * 网址导航·子分类
 *
 * 主分类（web_categories）下的二级分组：
 * - 不在左侧/顶部「分类列表」里平铺，只在该分类的内容面板内以分组区块呈现；
 * - 独立建表而非给 web_categories 加 parentId，避免污染主分类的排序/级联删除/拖拽逻辑；
 * - 删除子分类时其下网站回到主分类的「未分组」区（subCategoryId 置空），不丢数据。
 */
export const navSubCategories = sqliteTable(
  'nav_sub_categories',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 所属主分类 */
    categoryId: text('category_id').notNull(),
    /** 子分类名 */
    name: text('name').notNull(),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('nav_sub_categories_category_idx').on(table.categoryId),
    index('nav_sub_categories_sort_idx').on(table.sort),
  ],
);

/** 网址导航·网站 */
export const websites = sqliteTable(
  'websites',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 所属分类 */
    categoryId: text('category_id').notNull(),
    /** 所属子分类（可空 = 该主分类的「未分组」区） */
    subCategoryId: text('sub_category_id'),
    /** 网站名 */
    name: text('name').notNull(),
    /** 网址 */
    url: text('url').notNull(),
    /** 图标 URL（可空；空则自动抓 favicon） */
    icon: text('icon'),
    /** 一句话简介（可空） */
    desc: text('desc'),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('websites_category_idx').on(table.categoryId),
    index('websites_sub_category_idx').on(table.subCategoryId),
    index('websites_sort_idx').on(table.sort),
  ],
);

/** 学习模式·番茄记录（公开统计；仅落完整完成的番茄） */
export const studySessions = sqliteTable(
  'study_sessions',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 关联任务 id（可空；公开聚合不返回任务名） */
    taskId: text('task_id'),
    /** 实际专注秒数 */
    durationSec: integer('duration_sec').notNull(),
    /** 是否完整完成（仅 completed=true 入库） */
    completed: integer('completed', { mode: 'boolean' }).notNull().default(true),
    /** 完成时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('study_sessions_task_idx').on(table.taskId),
    index('study_sessions_created_idx').on(table.createdAt),
  ],
);

/** 学习模式·任务（私密，登录） */
export const studyTasks = sqliteTable(
  'study_tasks',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 任务名 */
    title: text('title').notNull(),
    /** 预估番茄数 */
    estPomodoros: integer('est_pomodoros').notNull().default(1),
    /** 是否完成 */
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    /** 更新时间 */
    updatedAt: timestampMs('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('study_tasks_created_idx').on(table.createdAt),
  ],
);

/** 学习模式·打断记录（私密，登录） */
export const studyDistractions = sqliteTable(
  'study_distractions',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 类型：internal（走神/想起事）| external（他人/环境） */
    type: text('type').notNull(),
    /** 备注 */
    note: text('note').notNull().default(''),
    /** 记录时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('study_distractions_created_idx').on(table.createdAt),
  ],
);

/** 文档系统·分类 */
export const docCategories = sqliteTable(
  'doc_categories',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 分类名 */
    name: text('name').notNull(),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('doc_categories_sort_idx').on(table.sort),
  ],
);

/** 文档系统·文档（一本书 / 一个手册） */
export const docBundles = sqliteTable(
  'doc_bundles',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 所属分类 */
    categoryId: text('category_id').notNull(),
    /** 文档名 */
    name: text('name').notNull(),
    /** 图标（emoji/文字，可空） */
    icon: text('icon'),
    /** 一句话简介（可空） */
    summary: text('summary'),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('doc_bundles_category_idx').on(table.categoryId),
    index('doc_bundles_sort_idx').on(table.sort),
  ],
);

/** 文档系统·文章（正文存 MDX 源码，服务端 renderMdx 渲染） */
export const docArticles = sqliteTable(
  'doc_articles',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 所属文档 */
    bundleId: text('bundle_id').notNull(),
    /** 文章标题 */
    title: text('title').notNull(),
    /** MDX 源码 */
    content: text('content').notNull().default(''),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    /** 更新时间 */
    updatedAt: timestampMs('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('doc_articles_bundle_idx').on(table.bundleId),
    index('doc_articles_sort_idx').on(table.sort),
  ],
);

/**
 * 文档系统·节点（册内多级目录：目录可嵌套，目录下挂文章）
 * 替代/并轨 doc_articles：kind='article' 的节点即文章；kind='folder' 为目录。
 */
export const docNodes = sqliteTable(
  'doc_nodes',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 所属文档（册） */
    bundleId: text('bundle_id').notNull(),
    /** 父目录 id（null = 册根级） */
    parentId: text('parent_id'),
    /** 节点类型：folder=目录 / article=文章 */
    kind: text('kind').notNull(),
    /** 标题 */
    title: text('title').notNull(),
    /** 文章正文（MDX；目录节点为空） */
    content: text('content').notNull().default(''),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    /** 更新时间 */
    updatedAt: timestampMs('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('doc_nodes_bundle_idx').on(table.bundleId),
    index('doc_nodes_parent_idx').on(table.parentId),
    index('doc_nodes_sort_idx').on(table.sort),
  ],
);

/** 学习打卡·任务 */
export const checkinTasks = sqliteTable(
  'checkin_tasks',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 任务名 */
    name: text('name').notNull(),
    /** 图标（emoji/文字，可空） */
    icon: text('icon'),
    /** 最大可补签天数（默认 1） */
    maxMakeupDays: integer('max_makeup_days').notNull().default(1),
    /** 排序（升序） */
    sort: integer('sort').notNull().default(0),
    /** 创建时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('checkin_tasks_sort_idx').on(table.sort),
  ],
);

/** 学习打卡·记录（taskId + date 唯一，同日同任务一条） */
export const checkinRecords = sqliteTable(
  'checkin_records',
  {
    /** UUID 主键 */
    id: text('id').primaryKey(),
    /** 所属任务 */
    taskId: text('task_id').notNull(),
    /** 打卡日期 YYYY-MM-DD */
    date: text('date').notNull(),
    /** 打卡时间 */
    createdAt: timestampMs('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique('checkin_records_task_date_unique').on(table.taskId, table.date),
    index('checkin_records_task_idx').on(table.taskId),
  ],
);