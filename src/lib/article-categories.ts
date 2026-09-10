/**
 * 写作台·自定义文章分类（数据访问层）
 *
 * 与固定维度 `articles.type`（tech/note/photo）**并存**：type 是内置三分类，
 * 本模块是用户可自由增删改排序的自定义分类，用于写作台左栏分组与筛选。
 *
 * 存储设计：
 * - `article_categories`：分类本体（name / color / sort）；
 * - `article_post_categories`：文章 → 分类归属（article_id 主键，单分类语义）。
 *   刻意**不给 articles 加列**：生产库未执行迁移端点时本表缺失，只让分类功能降级
 *   （列表为空、归属为空），不会让文章主查询（META_COLUMNS 不含分类）500。
 *
 * ⚠️ 所有导出函数均对「表不存在 / 缺列」做容错：捕获异常后返回空结果或 false，
 *    调用方无需 try/catch。
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { articleCategories, articlePostCategories } from '../../db/schema.sqlite';

/** 分类视图（对外形态） */
export interface ArticleCategory {
  id: string;
  name: string;
  /** 主题色（空串 = 跟随站点主色） */
  color: string;
  sort: number;
}

/** 随机 id（crypto.randomUUID 兜底） */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 列出全部分类（按 sort 升序，同 sort 按创建时间）
 *
 * @returns 分类数组；表缺失时返回空数组
 */
export async function listArticleCategories(): Promise<ArticleCategory[]> {
  try {
    const rows = await db
      .select({
        id: articleCategories.id,
        name: articleCategories.name,
        color: articleCategories.color,
        sort: articleCategories.sort,
      })
      .from(articleCategories)
      .orderBy(asc(articleCategories.sort));
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color ?? '', sort: r.sort }));
  } catch {
    // 表尚未迁移 → 功能降级（写作台回落到「按类型分组」）
    return [];
  }
}

/**
 * 文章 → 分类 id 映射（仅返回有归属的条目）
 *
 * @returns `Map<articleId, categoryId>`；表缺失时返回空 Map
 */
export async function articleCategoryMap(): Promise<Map<string, string>> {
  try {
    const rows = await db
      .select({ articleId: articlePostCategories.articleId, categoryId: articlePostCategories.categoryId })
      .from(articlePostCategories);
    return new Map(rows.map((r) => [r.articleId, r.categoryId]));
  } catch {
    return new Map();
  }
}

/**
 * 创建分类（追加到末尾）
 *
 * @param name 分类名（调用方保证非空且已 trim）
 * @param color 主题色（空串 = 跟随主色）
 * @returns 新建分类；失败返回 null
 */
export async function createArticleCategory(name: string, color = ''): Promise<ArticleCategory | null> {
  try {
    const all = await listArticleCategories();
    const sort = all.reduce((max, c) => Math.max(max, c.sort), -1) + 1;
    const row = { id: newId(), name, color, sort };
    await db.insert(articleCategories).values({ ...row, createdAt: new Date() });
    return { id: row.id, name: row.name, color: row.color, sort: row.sort };
  } catch {
    return null;
  }
}

/**
 * 重命名 / 改色（局部更新，未传字段保持不变）
 *
 * @param id 分类 id
 * @param patch 待更新字段
 * @returns 是否成功
 */
export async function updateArticleCategory(
  id: string,
  patch: { name?: string; color?: string },
): Promise<boolean> {
  try {
    const next: Record<string, unknown> = {};
    if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
    if (typeof patch.color === 'string') next.color = patch.color;
    if (Object.keys(next).length === 0) return false;
    await db.update(articleCategories).set(next).where(eq(articleCategories.id, id));
    return true;
  } catch {
    return false;
  }
}

/**
 * 重排分类（整序提交：按给定 id 顺序重写 sort = 0..n-1）
 *
 * @param orderedIds 期望顺序的分类 id 列表
 * @returns 是否成功
 */
export async function reorderArticleCategories(orderedIds: string[]): Promise<boolean> {
  try {
    for (let i = 0; i < orderedIds.length; i += 1) {
      const id = orderedIds[i];
      if (!id) continue;
      await db.update(articleCategories).set({ sort: i }).where(eq(articleCategories.id, id));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 删除分类（同时解除其下文章归属，文章本身不删除）
 *
 * @param id 分类 id
 * @returns 是否成功
 */
export async function deleteArticleCategory(id: string): Promise<boolean> {
  try {
    await db.delete(articlePostCategories).where(eq(articlePostCategories.categoryId, id));
    await db.delete(articleCategories).where(eq(articleCategories.id, id));
    return true;
  } catch {
    return false;
  }
}

/**
 * 设置文章所属分类（空 categoryId = 解除归属，归入「未分类」）
 *
 * @param articleId 文章 id
 * @param categoryId 目标分类 id（空串/null = 解除）
 * @returns 是否成功
 */
export async function setArticleCategory(articleId: string, categoryId: string | null): Promise<boolean> {
  try {
    if (!categoryId) {
      await db.delete(articlePostCategories).where(eq(articlePostCategories.articleId, articleId));
      return true;
    }
    await db
      .insert(articlePostCategories)
      .values({ articleId, categoryId, createdAt: new Date() })
      .onConflictDoUpdate({
        target: articlePostCategories.articleId,
        set: { categoryId },
      });
    return true;
  } catch {
    return false;
  }
}

/**
 * 批量删除文章归属（文章被删除时清理，避免孤儿行）
 *
 * @param articleIds 文章 id 列表
 */
export async function clearArticleCategories(articleIds: string[]): Promise<void> {
  if (articleIds.length === 0) return;
  try {
    await db.delete(articlePostCategories).where(inArray(articlePostCategories.articleId, articleIds));
  } catch {
    /* 表缺失时无需清理 */
  }
}
