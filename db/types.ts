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
  /** 标签列表 */
  tags: string[];
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
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
  /** 可选：显式指定 slug；为空则由标题自动生成 */
  slug?: string;
}
