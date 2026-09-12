/**
 * 文章阅读量数据访问层（归档页「x 阅读」的数据源）
 *
 * ## 口径：每次访问 +1，不做任何去重
 *
 * 这是与 `likes.ts` 的**关键差异**，且属**有意设计**（非疏漏）：
 * - 点赞需要「同一身份唯一」才能做幂等 toggle（赞↔取消），故有 `unique` 约束；
 * - 阅读量的产品口径被明确设定为「每次访问 +1」，没有身份维度，
 *   表里就是一行一次访问的流水，写入路径只有纯 INSERT（最轻）。
 *
 * 代价与缓解：
 * - 刷新会累加 → 上报放在**客户端**（`/api/views`），避免 SSR / 预取被计入；
 * - 表会持续增长 → 目前不设清理策略，属已知预留项（见设计文档）。
 *
 * 所有查询都把 `count()` 显式转 `Number`：PG 的 `count()` 返回 bigint **字符串**，
 * 直接参与前端算术/比较会出问题（与 `likes.ts` 同处理）。
 */
import { count, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { articleViews } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { ArticleView } from '../../db/types';

/**
 * 记录一次文章阅读（每次调用 +1，不去重）。
 *
 * @param articleId 文章 id
 */
export async function recordView(articleId: string): Promise<void> {
  await db.insert(articleViews).values({
    id: randomUUID(),
    articleId,
    createdAt: new Date(),
  });
}

/**
 * 统计单篇文章阅读量。
 *
 * @param articleId 文章 id
 * @returns 阅读次数（无记录为 0）
 */
export async function countViews(articleId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(articleViews)
    .where(eq(articleViews.articleId, articleId));
  return Number(rows[0]?.n ?? 0);
}

/**
 * 批量统计多篇文章阅读量（归档页一次查询，返回 articleId → 次数）。
 *
 * 空数组直接返回空对象、不发查询 —— 避免 SQLite/PG 对 `IN ()` 的语法差异。
 *
 * @param articleIds 文章 id 列表
 * @returns articleId → 阅读次数（无记录的文章不出现在结果里）
 */
export async function countViewsByTargets(articleIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(articleIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = await db
    .select({ articleId: articleViews.articleId, n: count() })
    .from(articleViews)
    .where(inArray(articleViews.articleId, ids))
    .groupBy(articleViews.articleId);
  const map: Record<string, number> = {};
  rows.forEach((r) => {
    map[r.articleId] = Number(r.n);
  });
  return map;
}

/**
 * 查看某篇文章的原始阅读流水（供管理/调试用）。
 *
 * @param articleId 文章 id
 * @returns 按时间升序的流水行
 */
export async function listViews(articleId: string): Promise<ArticleView[]> {
  const rows = await db
    .select()
    .from(articleViews)
    .where(eq(articleViews.articleId, articleId))
    .orderBy(articleViews.createdAt);
  return rows.map((r) => ({
    id: r.id,
    articleId: r.articleId,
    createdAt: r.createdAt,
  }));
}
