/**
 * 网址导航数据访问层（分类 + 网站，按分类聚合）
 *
 * - 公共页读聚合视图 listNav()（分类按 sort，网站按 sort）；
 * - 管理端 CRUD：分类增删改（删除级联其下网站）、网站增删改（改 categoryId = 移动分类）；
 * - favicon 工具：从 URL 提取域名，生成自动图标 URL。
 */
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { webCategories, websites } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { NavCategoryView, WebCategory, Website } from '../../db/types';

/* ---------------- 查询 ---------------- */

/** 导航聚合视图（分类 + 其下网站，按 sort 升序） */
export async function listNav(): Promise<NavCategoryView[]> {
  const cats = await db.select().from(webCategories).orderBy(asc(webCategories.sort), asc(webCategories.createdAt));
  const sites = await db.select().from(websites).orderBy(asc(websites.sort), asc(websites.createdAt));
  const byCategory = new Map<string, Website[]>();
  sites.forEach((s) => {
    const list = byCategory.get(s.categoryId) ?? [];
    list.push(s);
    byCategory.set(s.categoryId, list);
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

/** 删除分类（级联删除其下网站） */
export async function deleteCategory(id: string): Promise<void> {
  await db.delete(websites).where(eq(websites.categoryId, id));
  await db.delete(webCategories).where(eq(webCategories.id, id));
}

/* ---------------- 网站 CRUD ---------------- */

export async function createWebsite(input: {
  categoryId: string;
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

export async function updateWebsite(
  id: string,
  input: { categoryId?: string; name?: string; url?: string; icon?: string | null; desc?: string | null; sort?: number },
): Promise<Website | null> {
  const patch: Record<string, unknown> = {};
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
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