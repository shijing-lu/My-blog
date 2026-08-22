/**
 * 文章数据访问层（业务逻辑 + 数据库读写）
 *
 * 说明：
 * - 查询基于 sqlite schema 元数据构建，对 pg 同样生成合法 SQL（见 `db/index.ts` 注释）。
 * - 标签统一经 `serializeTags`/`parseTags` 编解码，对外形态为 `string[]`。
 * - `saveDraft` 为「按 id upsert」语义，slug 为空时由标题自动生成，冲突追加后缀。
 */
import { desc, eq, count } from 'drizzle-orm';
import { articles } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { Article, ArticleMeta, ArticleType, ArticleUpsertInput } from '../../db/types';
import { parseTags, serializeTags } from './tags';
import { slugifyOrFallback } from './slugify';
import { extractFirstImage } from './images';

/** 数据库原始行类型（sqlite 形态，tags 为 JSON 文本） */
type ArticleRow = typeof articles.$inferSelect;

/**
 * 行 → 实体映射（解码 tags、收窄 type 联合）
 *
 * @param row 数据库行
 * @returns 对外统一实体
 */
function mapRow(row: ArticleRow): Article {
  return { ...row, tags: parseTags(row.tags), type: row.type as ArticleType };
}

/** 封面 URL 规范化：空串视为 null */
function normalizeCover(cover: string | null | undefined): string | null {
  const v = cover?.trim();
  return v ? v : null;
}

/** 计算文章最终封面：手动指定优先，否则取正文第一张图，都没有返回 null */
export function resolveCover(article: Pick<Article, 'cover' | 'content'>): string | null {
  return normalizeCover(article.cover) ?? extractFirstImage(article.content);
}

/** 文章元信息列（不含 content，供列表/侧栏等轻量场景） */
const META_COLUMNS = {
  id: articles.id,
  title: articles.title,
  slug: articles.slug,
  type: articles.type,
  summary: articles.summary,
  cover: articles.cover,
  tags: articles.tags,
  createdAt: articles.createdAt,
  updatedAt: articles.updatedAt,
};

/**
 * 列出全部文章元信息（按更新时间倒序，不含正文）
 *
 * @returns 文章元信息数组
 */
export async function listArticleMeta(): Promise<ArticleMeta[]> {
  const rows = await db.select(META_COLUMNS).from(articles).orderBy(desc(articles.updatedAt));
  return rows.map((r) => ({ ...r, tags: parseTags(r.tags), type: r.type as ArticleType }));
}

/**
 * 列出全部文章（按更新时间倒序）
 *
 * @returns 文章实体数组
 */
export async function listArticles(): Promise<Article[]> {
  const rows = await db.select().from(articles).orderBy(desc(articles.updatedAt));
  return rows.map(mapRow);
}

/** 文章总数 */
export async function countArticles(): Promise<number> {
  const rows = await db.select({ n: count() }).from(articles);
  return rows[0]?.n ?? 0;
}

/**
 * 分页列出文章（按更新时间倒序，含正文）
 *
 * @param page 页码（1 起）
 * @param pageSize 每页数量
 * @returns 当前页文章实体数组
 */
export async function listArticlePage(page: number, pageSize: number): Promise<Article[]> {
  const offset = (page - 1) * pageSize;
  const rows = await db
    .select()
    .from(articles)
    .orderBy(desc(articles.updatedAt))
    .limit(pageSize)
    .offset(Math.max(0, offset));
  return rows.map(mapRow);
}

/**
 * 按 slug 查询文章
 *
 * @param slug URL 标识
 * @returns 文章实体或 null
 */
export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const rows = await db.select().from(articles).where(eq(articles.slug, slug)).limit(1);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * 按 id 查询文章
 *
 * @param id UUID
 * @returns 文章实体或 null
 */
export async function getArticleById(id: string): Promise<Article | null> {
  const rows = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * 删除文章
 *
 * @param id UUID
 */
export async function deleteArticle(id: string): Promise<void> {
  await db.delete(articles).where(eq(articles.id, id));
}

/**
 * 生成唯一 slug：存在冲突时依次追加 -2、-3 …（上限 99 次，兜底追加时间戳）
 *
 * @param base 基础 slug
 * @returns 保证未占用的 slug
 */
async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'untitled';
  let candidate = root;
  for (let i = 2; i < 100; i += 1) {
    const existing = await getArticleBySlug(candidate);
    if (!existing) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/**
 * 保存草稿（按 id upsert）
 *
 * - 已存在 → 更新内容并刷新 updatedAt（slug 沿用原值，除非显式传入新 slug）。
 * - 不存在 → 插入新行；slug 优先取显式传入值，否则由标题生成并保证唯一。
 *
 * @param input 保存入参
 * @returns 保存后的完整实体
 */
export async function saveDraft(input: ArticleUpsertInput): Promise<Article> {
  const now = new Date();
  const existing = await getArticleById(input.id);

  if (existing) {
    const slug = input.slug?.trim() || existing.slug;
    const rows = await db
      .update(articles)
      .set({
        title: input.title,
        slug,
        content: input.content,
        type: input.type,
        summary: input.summary,
        cover: normalizeCover(input.cover),
        tags: serializeTags(input.tags),
        updatedAt: now,
      })
      .where(eq(articles.id, input.id))
      .returning();
    return mapRow(rows[0] as ArticleRow);
  }

  const slug = input.slug?.trim() || (await uniqueSlug(slugifyOrFallback(input.title)));
  const rows = await db
    .insert(articles)
    .values({
      id: input.id,
      title: input.title,
      slug,
      content: input.content,
      type: input.type,
      summary: input.summary,
      cover: normalizeCover(input.cover),
      tags: serializeTags(input.tags),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapRow(rows[0] as ArticleRow);
}
