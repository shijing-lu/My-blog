/**
 * 数据库层共享类型（与具体方言无关）
 *
 * 说明：
 * - 文章类型为 TS 联合类型 + 数据库 check 约束（SQLite 无原生 enum）。
 * - `tags` 在 SQLite 中以 JSON 文本存储，在 PostgreSQL 中以 jsonb 存储；
 *   对外统一暴露 `string[]`，编解码见 `src/lib/tags.ts`。
 * - 时间戳两侧方言均映射为 `Date`。
 */

/** 文章类型：tech=技术教程 / note=学习笔记 / photo=随笔·摄影 */
export type ArticleType = 'tech' | 'note' | 'photo';

/** 全部合法文章类型（用于校验与循环渲染） */
export const ARTICLE_TYPES: readonly ArticleType[] = ['tech', 'note', 'photo'] as const;

/** 类型守卫：判断未知值是否为合法文章类型 */
export function isArticleType(value: unknown): value is ArticleType {
  return typeof value === 'string' && (ARTICLE_TYPES as readonly string[]).includes(value);
}

/** 文章完整实体（对外统一形态，tags 已解码为数组） */
export interface Article {
  /** UUID 主键 */
  id: string;
  /** 标题 */
  title: string;
  /** 唯一 URL 标识 */
  slug: string;
  /** MDX 源码 */
  content: string;
  /** 文章类型 */
  type: ArticleType;
  /** 摘要（列表/搜索展示） */
  summary: string;
  /** 手动指定的封面 URL（null = 未指定，回落到正文首图） */
  cover: string | null;
  /** 标签列表 */
  tags: string[];
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/** 文章元信息（不含 content，用于列表/侧栏等轻量场景） */
export interface ArticleMeta {
  id: string;
  title: string;
  slug: string;
  type: ArticleType;
  summary: string;
  cover: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** 保存/创建文章的入参（saveDraft 按 id upsert） */
export interface ArticleUpsertInput {
  id: string;
  title: string;
  type: ArticleType;
  summary: string;
  tags: string[];
  content: string;
  /** 手动指定封面 URL；空字符串视为未指定 */
  cover?: string | null;
  /** 可选：显式指定 slug；为空则由标题自动生成 */
  slug?: string;
}

/** 相册照片完整实体 */
export interface Photo {
  /** UUID 主键 */
  id: string;
  /** 原图 URL */
  url: string;
  /** 缩略图 URL（null = 用原图） */
  thumbUrl: string | null;
  /** 可选标题 */
  title: string;
  /** 原图宽度（未知可为 null） */
  width: number | null;
  /** 原图高度 */
  height: number | null;
  /** 展示日期（用户自定义） */
  takenAt: Date;
  /** 上传时间 */
  createdAt: Date;
}

/** 相册照片写入入参 */
export interface NewPhoto {
  id: string;
  url: string;
  thumbUrl: string | null;
  title: string;
  width: number | null;
  height: number | null;
  takenAt: Date;
}

/** 日历：待办 */
export interface Todo {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  text: string;
  done: boolean;
  createdAt: Date;
}

/** 日历：日记（一天一篇） */
export interface DiaryEntry {
  id: string;
  /** YYYY-MM-DD（唯一） */
  date: string;
  title: string;
  /** Markdown 正文 */
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 日历：重要日期 */
export interface CalendarEvent {
  id: string;
  title: string;
  /** 阳历日期 YYYY-MM-DD（lunar 为 false 时使用） */
  date: string;
  /** 是否每年重复 */
  repeat: boolean;
  /** 是否农历日期 */
  lunar: boolean;
  /** 农历月日 "MM-DD"（闰月 "-MM-DD"） */
  lunarDate: string | null;
  createdAt: Date;
}

/** 动态媒体项 */
export interface MomentMedia {
  /** image | gif | video */
  type: 'image' | 'gif' | 'video';
  /** 媒体 URL（图片/GIF 为本站 /api/images/…，视频为外链） */
  url: string;
  /** 视频封面（可选） */
  poster?: string | null;
}

/** 动态（动态圈） */
export interface Moment {
  id: string;
  /** 文字内容（可为空但需有媒体） */
  content: string;
  /** 媒体列表 */
  media: MomentMedia[];
  createdAt: Date;
  updatedAt: Date;
}

/** 动态写入入参 */
export interface NewMoment {
  id: string;
  content: string;
  media: MomentMedia[];
  createdAt: Date;
  updatedAt: Date;
}

/** 点赞目标类型：文章 / 动态 / 评论 */
export type LikeTargetType = 'article' | 'moment' | 'comment';

/** 点赞者类型：匿名（浏览器指纹）/ GitHub 登录 */
export type LikeUserType = 'anonymous' | 'github';

/** 点赞 */
export interface Like {
  id: string;
  targetType: LikeTargetType;
  targetId: string;
  userType: LikeUserType;
  /** 身份标识：匿名 = 指纹；GitHub = token 哈希 */
  userIdent: string;
  createdAt: Date;
}

/** 点赞入参 */
export interface NewLike {
  id: string;
  targetType: LikeTargetType;
  targetId: string;
  userType: LikeUserType;
  userIdent: string;
  createdAt: Date;
}

/** GitHub 登录用户（评论/点赞身份） */
export interface GithubUser {
  /** 本站 UUID */
  id: string;
  /** GitHub 用户 ID */
  githubId: number;
  /** GitHub 用户名 */
  login: string;
  /** 显示昵称 */
  name: string;
  /** 头像 URL */
  avatarUrl: string;
  createdAt: Date;
}

/** 评论目标类型（与点赞一致） */
export type CommentTargetType = 'article' | 'moment';

/** 评论（含嵌套回复；作者匿名或 GitHub） */
export interface Comment {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  /** 回复的父评论 id（null = 顶级） */
  parentId: string | null;
  content: string;
  authorType: 'anonymous' | 'github';
  authorName: string;
  githubUserId: string | null;
  likeCount: number;
  createdAt: Date;
}

/** 评论入参 */
export interface NewComment {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  parentId: string | null;
  content: string;
  authorType: 'anonymous' | 'github';
  authorName: string;
  githubUserId: string | null;
  createdAt: Date;
}

/** 自定义字体（管理员本地导入） */
export interface BlogFont {
  id: string;
  /** 字体族名（@font-face font-family） */
  familyName: string;
  mime: string;
  /** 字体二进制（base64） */
  data: string;
  /** 字节数 */
  size: number;
  createdAt: Date;
}

/** 字体选择：system=系统字体栈 | builtin=内置字体 | custom=自定义导入字体 */
export interface FontChoice {
  type: 'system' | 'builtin' | 'custom';
  /** system: 栈名（sans/serif/mono）；builtin: 内置名；custom: fonts.id */
  value: string;
}

/** 全局字体设置（文章字体 + 其他字体） */
export interface SiteFonts {
  article: FontChoice;
  ui: FontChoice;
}

/** 思维导图（绑定文章或独立；data 为 simple-mind-map 全量 JSON 字符串） */
export interface Mindmap {
  id: string;
  /** 导图标题 */
  title: string;
  /** 绑定文章 id（null = 独立导图） */
  articleId: string | null;
  /** simple-mind-map 全量数据 JSON（layout/root/theme/view + 节点锚点） */
  data: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 思维导图元信息（列表用，不含 data） */
export interface MindmapMeta {
  id: string;
  title: string;
  articleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 网址导航·分类 */
export interface WebCategory {
  id: string;
  name: string;
  icon: string | null;
  sort: number;
  createdAt: Date;
}

/** 网址导航·网站 */
export interface Website {
  id: string;
  categoryId: string;
  name: string;
  url: string;
  icon: string | null;
  desc: string | null;
  sort: number;
  createdAt: Date;
}

/** 网址导航·聚合视图（公共页渲染：分类 + 其下网站） */
export interface NavCategoryView {
  id: string;
  name: string;
  icon: string | null;
  sort: number;
  sites: Array<Pick<Website, 'id' | 'name' | 'url' | 'icon' | 'desc' | 'categoryId'>>;
}
