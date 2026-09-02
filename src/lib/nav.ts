/**
 * 网址导航数据访问层（分类 + 子分类 + 网站，按分类聚合）
 *
 * - 公共页读聚合视图 listNav()（分类按 sort，子分类按 sort，网站按 sort）；
 * - 管理端 CRUD：分类增删改（删除级联其子分类与网站）、子分类增删改、网站增删改
 *   （改 categoryId = 移动分类，此时自动清空 subCategoryId 以免跨分类悬挂）；
 * - favicon 工具：从 URL 提取域名，生成自动图标 URL。
 */
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { navSubCategories, webCategories, websites } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { NavCategoryView, NavSubCategory, WebCategory, Website } from '../../db/types';

/* ---------------- 查询 ---------------- */

/** 导航聚合视图（分类 + 子分类 + 其下网站，均按 sort 升序） */
export async function listNav(): Promise<NavCategoryView[]> {
  const cats = await db.select().from(webCategories).orderBy(asc(webCategories.sort), asc(webCategories.createdAt));
  const subs = await db.select().from(navSubCategories).orderBy(asc(navSubCategories.sort), asc(navSubCategories.createdAt));
  const sites = await db.select().from(websites).orderBy(asc(websites.sort), asc(websites.createdAt));
  const byCategory = new Map<string, Website[]>();
  sites.forEach((s) => {
    const list = byCategory.get(s.categoryId) ?? [];
    list.push(s);
    byCategory.set(s.categoryId, list);
  });
  const subsByCategory = new Map<string, NavSubCategory[]>();
  subs.forEach((s) => {
    const list = subsByCategory.get(s.categoryId) ?? [];
    list.push(s);
    subsByCategory.set(s.categoryId, list);
  });
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    sort: c.sort,
    sites: (byCategory.get(c.id) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      icon: s.icon,
      desc: s.desc,
      categoryId: s.categoryId,
      subCategoryId: s.subCategoryId,
    })),
    subCategories: (subsByCategory.get(c.id) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      sort: s.sort,
    })),
  }));
}

/** 全部分类（管理端） */
export async function listCategories(): Promise<WebCategory[]> {
  return (await db.select().from(webCategories).orderBy(asc(webCategories.sort), asc(webCategories.createdAt))) as WebCategory[];
}

/** 分类下的网站（管理端） */
export async function listSitesByCategory(categoryId: string): Promise<Website[]> {
  return (await db
    .select()
    .from(websites)
    .where(eq(websites.categoryId, categoryId))
    .orderBy(asc(websites.sort), asc(websites.createdAt))) as Website[];
}

/** 按 id 取网站 */
export async function getWebsite(id: string): Promise<Website | null> {
  const rows = await db.select().from(websites).where(eq(websites.id, id)).limit(1);
  return (rows[0] as Website | undefined) ?? null;
}

/* ---------------- 分类 CRUD ---------------- */

export async function createCategory(input: { name: string; icon: string | null; sort: number }): Promise<WebCategory> {
  const rows = await db
    .insert(webCategories)
    .values({ id: randomUUID(), name: input.name, icon: input.icon, sort: input.sort, createdAt: new Date() })
    .returning();
  return rows[0] as WebCategory;
}

export async function updateCategory(
  id: string,
  input: { name?: string; icon?: string | null; sort?: number },
): Promise<WebCategory | null> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.sort !== undefined) patch.sort = input.sort;
  const rows = await db.update(webCategories).set(patch).where(eq(webCategories.id, id)).returning();
  return (rows[0] as WebCategory | undefined) ?? null;
}

/** 删除分类（级联删除其下子分类与网站） */
export async function deleteCategory(id: string): Promise<void> {
  await db.delete(websites).where(eq(websites.categoryId, id));
  await db.delete(navSubCategories).where(eq(navSubCategories.categoryId, id));
  await db.delete(webCategories).where(eq(webCategories.id, id));
}

/* ---------------- 子分类 CRUD ---------------- */

/** 某个主分类下的子分类（按 sort 升序） */
export async function listSubCategories(categoryId: string): Promise<NavSubCategory[]> {
  return (await db
    .select()
    .from(navSubCategories)
    .where(eq(navSubCategories.categoryId, categoryId))
    .orderBy(asc(navSubCategories.sort), asc(navSubCategories.createdAt))) as NavSubCategory[];
}

/** 按 id 取子分类 */
export async function getSubCategory(id: string): Promise<NavSubCategory | null> {
  const rows = await db.select().from(navSubCategories).where(eq(navSubCategories.id, id)).limit(1);
  return (rows[0] as NavSubCategory | undefined) ?? null;
}

export async function createSubCategory(input: {
  categoryId: string;
  name: string;
  sort: number;
}): Promise<NavSubCategory> {
  const rows = await db
    .insert(navSubCategories)
    .values({
      id: randomUUID(),
      categoryId: input.categoryId,
      name: input.name,
      sort: input.sort,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as NavSubCategory;
}

export async function updateSubCategory(
  id: string,
  input: { name?: string; sort?: number },
): Promise<NavSubCategory | null> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.sort !== undefined) patch.sort = input.sort;
  const rows = await db.update(navSubCategories).set(patch).where(eq(navSubCategories.id, id)).returning();
  return (rows[0] as NavSubCategory | undefined) ?? null;
}

/**
 * 删除子分类：其下网站**回到主分类的「未分组」区**（subCategoryId 置空），不删网站。
 *
 * 与「删除主分类 = 级联删网站」区分开：子分类只是分组视图，删除分组不应丢失数据。
 */
export async function deleteSubCategory(id: string): Promise<void> {
  await db.update(websites).set({ subCategoryId: null }).where(eq(websites.subCategoryId, id));
  await db.delete(navSubCategories).where(eq(navSubCategories.id, id));
}

/** 子分类归属校验：该子分类是否属于指定主分类 */
export async function subCategoryBelongsTo(subCategoryId: string, categoryId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(navSubCategories)
    .where(and(eq(navSubCategories.id, subCategoryId), eq(navSubCategories.categoryId, categoryId)))
    .limit(1);
  return rows.length > 0;
}

/* ---------------- 网站 CRUD ---------------- */

export async function createWebsite(input: {
  categoryId: string;
  subCategoryId?: string | null;
  name: string;
  url: string;
  icon: string | null;
  desc: string | null;
  sort: number;
}): Promise<Website> {
  const rows = await db
    .insert(websites)
    .values({
      id: randomUUID(),
      categoryId: input.categoryId,
      subCategoryId: input.subCategoryId ?? null,
      name: input.name,
      url: input.url,
      icon: input.icon,
      desc: input.desc,
      sort: input.sort,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as Website;
}

/**
 * 更新网站。
 *
 * 一致性保证：若只改主分类（categoryId）而未显式指定 subCategoryId，
 * 则自动把 subCategoryId 清空 —— 旧子分类属于旧主分类，
 * 保留会造成「网站在 A 分类、却挂在 B 分类的子分类下」的悬挂引用。
 */
export async function updateWebsite(
  id: string,
  input: {
    categoryId?: string;
    subCategoryId?: string | null;
    name?: string;
    url?: string;
    icon?: string | null;
    desc?: string | null;
    sort?: number;
  },
): Promise<Website | null> {
  const patch: Record<string, unknown> = {};
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
  if (input.subCategoryId !== undefined) patch.subCategoryId = input.subCategoryId;
  else if (input.categoryId !== undefined) patch.subCategoryId = null;
  if (input.name !== undefined) patch.name = input.name;
  if (input.url !== undefined) patch.url = input.url;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.desc !== undefined) patch.desc = input.desc;
  if (input.sort !== undefined) patch.sort = input.sort;
  const rows = await db.update(websites).set(patch).where(eq(websites.id, id)).returning();
  return (rows[0] as Website | undefined) ?? null;
}

export async function deleteWebsite(id: string): Promise<void> {
  await db.delete(websites).where(eq(websites.id, id));
}

/* ---------------- favicon 工具 ---------------- */

/** 从网址提取域名（如 https://www.example.com/a → example.com） */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]!.replace(/^www\./, '');
  }
}

/** 自动图标 URL：手动 icon → 域名 /favicon.ico → Google favicon 兜底 */
export function autoIconUrl(url: string, manualIcon?: string | null): string {
  if (manualIcon) return manualIcon;
  const domain = extractDomain(url);
  return `https://${domain}/favicon.ico`;
}

/** Google favicon 兜底（favicon.ico 加载失败时用） */
export function googleFaviconUrl(url: string): string {
  const domain = extractDomain(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}