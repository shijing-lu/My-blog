/**
 * 文档系统数据访问层：分类 / 文档 / 文章 三级 + 聚合视图 + 搜索
 *
 * - 按 sort 升序 + createdAt 升序排序；
 * - 删除级联：删分类 → 其下文档 → 其下文章；删文档 → 其下文章；
 * - 聚合视图 listDocTree() 供公共页渲染（不含文章 content，减载荷）；
 * - 搜索对 分类名/文档名/简介/文章标题/正文 做大小写不敏感 LIKE 匹配。
 */
import { asc, eq, like, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { docArticles, docBundles, docCategories } from '../../db/schema.sqlite';
import { db } from '../../db';
import type {
  DocArticle,
  DocBundle,
  DocCategory,
  DocCategoryView,
  DocSearchResult,
} from '../../db/types';

/* ---------------- 聚合视图 ---------------- */

/** 按分类聚合的文档树（分类 → 文档 → 文章元信息；不含文章 content） */
export async function listDocTree(): Promise<DocCategoryView[]> {
  const cats = (await db.select().from(docCategories).orderBy(asc(docCategories.sort), asc(docCategories.createdAt))) as DocCategory[];
  const bundles = (await db.select().from(docBundles).orderBy(asc(docBundles.sort), asc(docBundles.createdAt))) as DocBundle[];
  const articles = (await db.select().from(docArticles).orderBy(asc(docArticles.sort), asc(docArticles.createdAt))) as DocArticle[];

  const byBundle = new Map<string, Array<Pick<DocArticle, 'id' | 'title' | 'sort'>>>();
  articles.forEach((a) => {
    const list = byBundle.get(a.bundleId) ?? [];
    list.push({ id: a.id, title: a.title, sort: a.sort });
    byBundle.set(a.bundleId, list);
  });

  return cats.map((c) => ({
    ...c,
    bundles: bundles
      .filter((b) => b.categoryId === c.id)
      .map((b) => ({
        id: b.id,
        name: b.name,
        icon: b.icon,
        summary: b.summary,
        sort: b.sort,
        createdAt: b.createdAt,
        articles: byBundle.get(b.id) ?? [],
      })),
  }));
}

/** 按 id 取文档（含 categoryId） */
export async function getBundle(id: string): Promise<DocBundle | null> {
  const rows = await db.select().from(docBundles).where(eq(docBundles.id, id)).limit(1);
  return (rows[0] as DocBundle | undefined) ?? null;
}

/** 按 id 取文章 */
export async function getDocArticle(id: string): Promise<DocArticle | null> {
  const rows = await db.select().from(docArticles).where(eq(docArticles.id, id)).limit(1);
  return (rows[0] as DocArticle | undefined) ?? null;
}

/* ---------------- 分类 CRUD ---------------- */

export async function createDocCategory(name: string, sort = 0): Promise<DocCategory> {
  const rows = await db
    .insert(docCategories)
    .values({ id: randomUUID(), name, sort, createdAt: new Date() })
    .returning();
  return rows[0] as DocCategory;
}

export async function updateDocCategory(id: string, patch: { name?: string; sort?: number }): Promise<DocCategory | null> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.sort !== undefined) set.sort = patch.sort;
  const rows = await db.update(docCategories).set(set).where(eq(docCategories.id, id)).returning();
  return (rows[0] as DocCategory | undefined) ?? null;
}

/** 删除分类（级联删除其下文档与文章） */
export async function deleteDocCategory(id: string): Promise<void> {
  const bundleIds = (await db.select({ id: docBundles.id }).from(docBundles).where(eq(docBundles.categoryId, id))).map((r) => r.id);
  for (const bid of bundleIds) await deleteDocBundle(bid);
  await db.delete(docCategories).where(eq(docCategories.id, id));
}

/* ---------------- 文档 CRUD ---------------- */

export async function createDocBundle(input: {
  categoryId: string;
  name: string;
  icon: string | null;
  summary: string | null;
  sort: number;
}): Promise<DocBundle> {
  const rows = await db
    .insert(docBundles)
    .values({
      id: randomUUID(),
      categoryId: input.categoryId,
      name: input.name,
      icon: input.icon,
      summary: input.summary,
      sort: input.sort,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as DocBundle;
}

export async function updateDocBundle(
  id: string,
  patch: { name?: string; icon?: string | null; summary?: string | null; categoryId?: string; sort?: number },
): Promise<DocBundle | null> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
  if (patch.sort !== undefined) set.sort = patch.sort;
  const rows = await db.update(docBundles).set(set).where(eq(docBundles.id, id)).returning();
  return (rows[0] as DocBundle | undefined) ?? null;
}

/** 删除文档（级联删除其下文章） */
export async function deleteDocBundle(id: string): Promise<void> {
  await db.delete(docArticles).where(eq(docArticles.bundleId, id));
  await db.delete(docBundles).where(eq(docBundles.id, id));
}

/* ---------------- 文章 CRUD ---------------- */

/** 列出某文档下的全部文章（含正文，供详情页三栏渲染） */
export async function listArticlesByBundle(bundleId: string): Promise<DocArticle[]> {
  return db
    .select()
    .from(docArticles)
    .where(eq(docArticles.bundleId, bundleId))
    .orderBy(asc(docArticles.sort), asc(docArticles.createdAt)) as Promise<DocArticle[]>;
}

export async function createDocArticle(input: {
  bundleId: string;
  title: string;
  content: string;
  sort: number;
}): Promise<DocArticle> {
  const now = new Date();
  const rows = await db
    .insert(docArticles)
    .values({
      id: randomUUID(),
      bundleId: input.bundleId,
      title: input.title,
      content: input.content,
      sort: input.sort,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0] as DocArticle;
}

export async function updateDocArticle(
  id: string,
  patch: { title?: string; content?: string; bundleId?: string; sort?: number },
): Promise<DocArticle | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.bundleId !== undefined) set.bundleId = patch.bundleId;
  if (patch.sort !== undefined) set.sort = patch.sort;
  const rows = await db.update(docArticles).set(set).where(eq(docArticles.id, id)).returning();
  return (rows[0] as DocArticle | undefined) ?? null;
}

export async function deleteDocArticle(id: string): Promise<DocArticle | null> {
  const rows = await db.delete(docArticles).where(eq(docArticles.id, id)).returning();
  return (rows[0] as DocArticle | undefined) ?? null;
}

/* ---------------- 搜索 ---------------- */

/**
 * 文档内搜索：匹配分类名/文档名/文档简介/文章标题/文章正文（大小写不敏感）
 * @param q 关键词
 * @param limit 每类最多返回条数
 */
export async function searchDocs(q: string, limit = 20): Promise<DocSearchResult> {
  const query = `%${q}%`;

  // 命中文档（name/summary 匹配）→ 附带分类名
  const bundleRows = await db
    .select({
      id: docBundles.id,
      name: docBundles.name,
      summary: docBundles.summary,
      icon: docBundles.icon,
      categoryId: docBundles.categoryId,
      categoryName: docCategories.name,
    })
    .from(docBundles)
    .leftJoin(docCategories, eq(docBundles.categoryId, docCategories.id))
    .where(or(like(docBundles.name, query), like(docBundles.summary, query)))
    .limit(limit);
  const bundles = bundleRows.map((r) => ({
    id: r.id,
    name: r.name,
    summary: r.summary,
    icon: r.icon,
    categoryName: r.categoryName ?? '',
  }));

  // 命中文章（title/content 匹配）→ 附带文档名
  const articleRows = await db
    .select({
      id: docArticles.id,
      title: docArticles.title,
      bundleId: docArticles.bundleId,
      bundleName: docBundles.name,
    })
    .from(docArticles)
    .leftJoin(docBundles, eq(docArticles.bundleId, docBundles.id))
    .where(or(like(docArticles.title, query), like(docArticles.content, query)))
    .limit(limit);
  const articles = articleRows.map((r) => ({ id: r.id, title: r.title, bundleId: r.bundleId, bundleName: r.bundleName ?? '' }));

  return { bundles, articles };
}
