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
import { encryptContent, parseEncryptMeta, ArticleCryptoError } from './article-crypto';

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
 * 计算保存时的加密相关字段。
 *
 * 加密语义（关键，勿回退）：
 * - `encrypt === true` 且有密码 → 加密 `content`，`content` 落库置空、写 `encryptMeta`。
 * - `encrypt === 'disable'` → 显式关闭加密：清空密文与提示；此时 `content` 落库为明文。
 * - 其他（缺省/false）→ **保留原有加密状态**，防止 500ms 防抖自动保存把已加密的
 *   密文覆盖成空串（自动保存时前端拿不到明文密码）。
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

  // 显式关闭加密：回到明文模式
  if (input.encrypt === 'disable') {
    return { content: input.content, encrypted: false, encryptHint: '', encryptMeta: '' };
  }

  // 显式开启加密
  if (input.encrypt === true) {
    // ⚠️ 顺序关键：`undefined`（字段缺省）与 `''`（用户留空）语义不同，
    // 必须先用「是否提供了字段」判定，再退回密码强度校验。
    // 已加密且未提供新密码 → 沿用旧密文（改标题摘要不该要求重输密码）。
    // 若把 `input.encryptPassword ?? ''` 放在前面，`undefined` 会被提前折叠为 `''`
    // 并命中「请设置访问密码」，使此分支永远不可达（线上曾由此导致改标题必 400）。
    if (prevEncrypted && input.encryptPassword === undefined) {
      return {
        content: '',
        encrypted: true,
        encryptHint: input.encryptHint?.trim() ?? existing?.encryptHint ?? '',
        encryptMeta: prevMeta,
      };
    }
    const password = input.encryptPassword ?? '';
    if (!password) {
      throw new ArticleCryptoError('请设置访问密码');
    }
    const meta = encryptContent(input.content, password);
    return {
      content: '',
      encrypted: true,
      encryptHint: (input.encryptHint ?? '').trim(),
      encryptMeta: JSON.stringify(meta),
    };
  }

  // 未指定：沿用既有加密状态
  if (prevEncrypted) {
    return {
      content: '',
      encrypted: true,
      encryptHint: input.encryptHint?.trim() ?? existing?.encryptHint ?? '',
      encryptMeta: prevMeta,
    };
  }
  return { content: input.content, encrypted: false, encryptHint: '', encryptMeta: '' };
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
