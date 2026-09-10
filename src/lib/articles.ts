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
import { hashPassword, parsePasswordHash, ArticlePasswordError, type PasswordHashMeta } from './article-password';

/** 数据库原始行类型（sqlite 形态，tags 为 JSON 文本） */
type ArticleRow = typeof articles.$inferSelect;

/**
 * 行 → 实体映射（解码 tags、收窄 type 联合、归一加密字段）
 *
 * 加密字段做**缺列容错**：新列在生产库需要一次性迁移（见 /api/migrate-article-crypto），
 * 迁移完成前旧行可能没有这三列 → 按「未加密」处理，避免整个文章列表 500。
 *
 * @param row 数据库行
 * @returns 对外统一实体
 */
function mapRow(row: ArticleRow): Article {
  const r = row as ArticleRow & {
    encrypted?: boolean | number | null;
    encryptHint?: string | null;
    encryptMeta?: string | null;
  };
  return {
    ...row,
    tags: parseTags(row.tags),
    type: row.type as ArticleType,
    encrypted: Boolean(r.encrypted),
    encryptHint: r.encryptHint ?? '',
    encryptMeta: r.encryptMeta ?? '',
  };
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
  encrypted: articles.encrypted,
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
  return rows.map((r) => ({
    ...r,
    tags: parseTags(r.tags),
    type: r.type as ArticleType,
    encrypted: Boolean(r.encrypted),
  }));
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
 * 计算保存时的「访问密码」相关字段。
 *
 * 语义（2026-09-10 由全文加密改造为服务端拦截，勿回退）：
 * - `encrypt === true` 且提供了新密码 → 存密码**哈希**到 `encryptMeta`；
 *   **`content` 照常落明文**（服务端拦截模式下不再清空正文）。
 * - `encrypt === true` 但未提供密码（undefined）→ 沿用旧哈希（改标题不该要求重输密码）。
 * - `encrypt === 'disable'` → 关闭拦截：清空哈希与提示，文章恢复公开。
 * - 缺省/其他 → 保留原有拦截状态。
 *
 * ⚠️ 与旧实现的关键差异：**不再把 content 置空**。旧实现置空是因为正文以
 * 密文存于 encryptMeta；现在正文明文入库，置空会导致正文丢失（线上事故根因）。
 *
 * ⚠️ 顺序陷阱（勿回退）：`undefined`（字段缺省=没改密码）与 `''`（用户留空）
 * 语义不同，必须**先用 `=== undefined` 判定沿用，再做密码校验**。若把
 * `input.encryptPassword ?? ''` 放前面，undefined 会被折叠成 '' 并命中
 * 「请设置访问密码」，使沿用分支成为死代码（曾导致改标题必 400）。
 *
 * @param input 保存入参
 * @param existing 已存在的行（null = 新建）
 * @returns 待写入的 { content, encrypted, encryptHint, encryptMeta }
 *
 * @internal 导出仅为单测覆盖，业务代码请用 saveDraft。
 */
export function resolveEncryption(
  input: ArticleUpsertInput,
  existing: Article | null,
): { content: string; encrypted: boolean; encryptHint: string; encryptMeta: string } {
  const prevMeta = existing?.encryptMeta ?? '';
  const prevEncrypted = Boolean(existing?.encrypted) && prevMeta !== '';

  // 显式关闭拦截：清空哈希与提示，正文保持明文
  if (input.encrypt === 'disable') {
    return { content: input.content, encrypted: false, encryptHint: '', encryptMeta: '' };
  }

  // 显式开启拦截
  if (input.encrypt === true) {
    // 已开启拦截且未提供新密码 → 沿用旧哈希（改标题摘要不该要求重输密码）
    if (prevEncrypted && input.encryptPassword === undefined) {
      return {
        content: input.content,
        encrypted: true,
        encryptHint: input.encryptHint?.trim() ?? existing?.encryptHint ?? '',
        encryptMeta: prevMeta,
      };
    }
    const password = input.encryptPassword ?? '';
    if (!password) {
      throw new ArticlePasswordError('请设置访问密码');
    }
    return {
      content: input.content,
      encrypted: true,
      encryptHint: (input.encryptHint ?? '').trim(),
      encryptMeta: JSON.stringify(hashPassword(password)),
    };
  }

  // 未指定：沿用既有拦截状态
  if (prevEncrypted) {
    return {
      content: input.content,
      encrypted: true,
      encryptHint: input.encryptHint?.trim() ?? existing?.encryptHint ?? '',
      encryptMeta: prevMeta,
    };
  }
  return { content: input.content, encrypted: false, encryptHint: '', encryptMeta: '' };
}

/**
 * 读取文章的密码校验元数据（供解锁接口使用）。
 *
 * 刻意只取校验所需字段，不返回正文，避免误用造成明文外泄。
 *
 * @param id 文章 id
 * @returns 拦截状态与密码哈希；文章不存在返回 null
 */
export async function getArticlePasswordMeta(
  id: string,
): Promise<{ id: string; encrypted: boolean; passwordMeta: PasswordHashMeta | null } | null> {
  const rows = await db
    .select({
      id: articles.id,
      encrypted: articles.encrypted,
      encryptMeta: articles.encryptMeta,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    encrypted: Boolean(row.encrypted),
    passwordMeta: parsePasswordHash((row.encryptMeta as string) ?? ''),
  };
}

/**
 * 保存草稿（按 id upsert）
 *
 * - 已存在 → 更新内容并刷新 updatedAt（slug 沿用原值，除非显式传入新 slug）。
 * - 不存在 → 插入新行；slug 优先取显式传入值，否则由标题生成并保证唯一。
 * - 加密文章：`content` 落库为空串，正文以密文存于 `encrypt_meta`。
 *
 * @param input 保存入参
 * @returns 保存后的完整实体
 */
export async function saveDraft(input: ArticleUpsertInput): Promise<Article> {
  const now = new Date();
  const existing = await getArticleById(input.id);
  const enc = resolveEncryption(input, existing);

  if (existing) {
    const slug = input.slug?.trim() || existing.slug;
    const rows = await db
      .update(articles)
      .set({
        title: input.title,
        slug,
        content: enc.content,
        type: input.type,
        summary: input.summary,
        cover: normalizeCover(input.cover),
        tags: serializeTags(input.tags),
        encrypted: enc.encrypted,
        encryptHint: enc.encryptHint,
        encryptMeta: enc.encryptMeta,
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
      content: enc.content,
      type: input.type,
      summary: input.summary,
      cover: normalizeCover(input.cover),
      tags: serializeTags(input.tags),
      encrypted: enc.encrypted,
      encryptHint: enc.encryptHint,
      encryptMeta: enc.encryptMeta,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapRow(rows[0] as ArticleRow);
}

/**
 * 关闭文章加密并回填明文正文（管理端「取消加密」场景）。
 *
 * @param id 文章 id
 * @param plaintext 待回填的明文 MDX
 * @returns 更新后的实体；文章不存在返回 null
 */
export async function disableEncryption(id: string, plaintext: string): Promise<Article | null> {
  const rows = await db
    .update(articles)
    .set({ content: plaintext, encrypted: false, encryptHint: '', encryptMeta: '', updatedAt: new Date() })
    .where(eq(articles.id, id))
    .returning();
  const row = rows[0];
  return row ? mapRow(row as ArticleRow) : null;
}
