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
import { docArticles, docBundles, docCategories, docNodes } from '../../db/schema.sqlite';
import { db } from '../../db';
import { clearRenderCache, invalidateRenderCache } from './mdx';
import type {
  DocArticle,
  DocBundle,
  DocCategory,
  DocCategoryView,
  DocNode,
  DocNodeView,
  DocSearchResult,
} from '../../db/types';

/* ---------------- 聚合视图 ---------------- */

/** 按分类聚合的文档树（分类 → 文档 → 文章元信息；不含文章 content） */
export async function listDocTree(): Promise<DocCategoryView[]> {
  const cats = (await db.select().from(docCategories).orderBy(asc(docCategories.sort), asc(docCategories.createdAt))) as DocCategory[];
  const bundles = (await db.select().from(docBundles).orderBy(asc(docBundles.sort), asc(docBundles.createdAt))) as DocBundle[];
  const articles = (await db.select().from(docArticles).orderBy(asc(docArticles.sort), asc(docArticles.createdAt))) as DocArticle[];
  // 节点统计（嵌套目录下的文章/目录数）
  const nodeRows = await db
    .select({ bundleId: docNodes.bundleId, kind: docNodes.kind })
    .from(docNodes);
  const nodeStats = new Map<string, { articleCount: number; folderCount: number }>();
  for (const n of nodeRows) {
    const s = nodeStats.get(n.bundleId) ?? { articleCount: 0, folderCount: 0 };
    if (n.kind === 'folder') s.folderCount += 1;
    else s.articleCount += 1;
    nodeStats.set(n.bundleId, s);
  }

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
      .map((b) => {
        const stats = nodeStats.get(b.id) ?? { articleCount: 0, folderCount: 0 };
        return {
          id: b.id,
          name: b.name,
          icon: b.icon,
          summary: b.summary,
          sort: b.sort,
          createdAt: b.createdAt,
          articles: byBundle.get(b.id) ?? [],
          articleCount: stats.articleCount,
          folderCount: stats.folderCount,
        };
      }),
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
  await db.delete(docNodes).where(eq(docNodes.bundleId, id));
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

  // 命中文章（doc_nodes 优先，doc_articles 兜底兼容；按 id 去重）
  const nodeRows2 = await db
    .select({
      id: docNodes.id,
      title: docNodes.title,
      bundleId: docNodes.bundleId,
      bundleName: docBundles.name,
    })
    .from(docNodes)
    .leftJoin(docBundles, eq(docNodes.bundleId, docBundles.id))
    .where(or(like(docNodes.title, query), like(docNodes.content, query)))
    .limit(limit);
  const legacyArticleRows = await db
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
  const seen = new Set<string>();
  const articles = [...nodeRows2, ...legacyArticleRows]
    .filter((r) => !seen.has(r.id) && (seen.add(r.id), true))
    .map((r) => ({ id: r.id, title: r.title, bundleId: r.bundleId, bundleName: r.bundleName ?? '' }));

  return { bundles, articles };
}


/* ---------------- 节点 CRUD（册内多级目录） ---------------- */

/** 列出某文档下的全部节点（含正文；供详情页三栏渲染与树构建） */
export async function listBundleNodes(bundleId: string): Promise<DocNode[]> {
  return db
    .select()
    .from(docNodes)
    .where(eq(docNodes.bundleId, bundleId))
    .orderBy(asc(docNodes.sort), asc(docNodes.createdAt)) as Promise<DocNode[]>;
}

/** 节点数组 → 嵌套树（folder 可含 children） */
export function buildNodeTree(nodes: DocNode[]): DocNodeView[] {
  const map = new Map<string, DocNodeView>();
  nodes.forEach((n) =>
    map.set(n.id, {
      id: n.id,
      bundleId: n.bundleId,
      parentId: n.parentId,
      kind: n.kind as 'folder' | 'article',
      title: n.title,
      sort: n.sort,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      children: [],
    }),
  );
  const roots: DocNodeView[] = [];
  map.forEach((v) => {
    if (v.parentId && map.has(v.parentId)) {
      map.get(v.parentId)!.children.push(v);
    } else {
      roots.push(v);
    }
  });
  const sortRec = (list: DocNodeView[]): void => {
    list.sort((a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime());
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** 按 id 取节点 */
export async function getDocNode(id: string): Promise<DocNode | null> {
  const rows = await db.select().from(docNodes).where(eq(docNodes.id, id)).limit(1);
  return (rows[0] as DocNode | undefined) ?? null;
}

/** 新建节点（folder=目录 / article=文章） */
export async function createDocNode(input: {
  bundleId: string;
  parentId: string | null;
  kind: 'folder' | 'article';
  title: string;
  content: string;
  sort: number;
}): Promise<DocNode> {
  const now = new Date();
  const rows = await db
    .insert(docNodes)
    .values({
      id: randomUUID(),
      bundleId: input.bundleId,
      parentId: input.parentId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      sort: input.sort,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0] as DocNode;
}

/** 更新节点（标题/正文/父目录/排序） */
export async function updateDocNode(
  id: string,
  patch: { title?: string; content?: string; parentId?: string | null; sort?: number },
): Promise<DocNode | null> {
  // 内容更新时失效旧源码的渲染缓存（B2 LRU），避免更新后命中旧 HTML
  if (patch.content !== undefined) {
    try {
      const old = await getDocNode(id);
      if (old) invalidateRenderCache(old.content);
    } catch { /* 失效失败不影响更新主流程 */ }
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.parentId !== undefined) set.parentId = patch.parentId;
  if (patch.sort !== undefined) set.sort = patch.sort;
  const rows = await db.update(docNodes).set(set).where(eq(docNodes.id, id)).returning();
  return (rows[0] as DocNode | undefined) ?? null;
}

/** 删除节点（级联删除其所有子孙） */
export async function deleteDocNode(id: string): Promise<DocNode | null> {
  const node = await getDocNode(id);
  if (!node) return null;
  const all = await listBundleNodes(node.bundleId);
  // 收集子孙 id（BFS）
  const childrenOf = new Map<string, string[]>();
  all.forEach((n) => {
    if (!n.parentId) return;
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n.id);
    childrenOf.set(n.parentId, list);
  });
  const toDelete = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const cid of childrenOf.get(cur) ?? []) {
      if (!toDelete.has(cid)) {
        toDelete.add(cid);
        queue.push(cid);
      }
    }
  }
  for (const did of toDelete) {
    await db.delete(docNodes).where(eq(docNodes.id, did));
  }
  // 级联删除涉及多篇文章，保守清空渲染缓存
  clearRenderCache();
  return node;
}