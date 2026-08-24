/**
 * 点赞数据访问层（文章/动态通用）
 *
 * - 身份：匿名（浏览器指纹）/ GitHub 登录（Twikoo token 哈希）分开计数；
 * - 唯一约束 (target_type, target_id, user_type, user_ident) 保证同一身份对同一
 *   目标最多一条，toggle 语义天然幂等：有则删（取消）、无则加（点赞）。
 */
import { and, count, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { likes } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { Like, LikeTargetType, LikeUserType } from '../../db/types';

/** 校验目标类型 */
export function isLikeTargetType(value: unknown): value is LikeTargetType {
  return value === 'article' || value === 'moment';
}

/** 校验点赞者类型 */
export function isLikeUserType(value: unknown): value is LikeUserType {
  return value === 'anonymous' || value === 'github';
}

/** 统计某目标点赞总数 */
export async function countLikes(targetType: LikeTargetType, targetId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(likes)
    .where(and(eq(likes.targetType, targetType), eq(likes.targetId, targetId)));
  return Number(rows[0]?.n ?? 0);
}

/** 按类型统计某目标点赞数（管理员拆分视图用） */
export async function countLikesByType(
  targetType: LikeTargetType,
  targetId: string,
): Promise<{ total: number; anonymous: number; github: number }> {
  const rows = await db
    .select({ type: likes.userType, n: count() })
    .from(likes)
    .where(and(eq(likes.targetType, targetType), eq(likes.targetId, targetId)))
    .groupBy(likes.userType);
  let anonymous = 0;
  let github = 0;
  rows.forEach((r) => {
    if (r.type === 'github') github = Number(r.n);
    else anonymous = Number(r.n);
  });
  return { total: anonymous + github, anonymous, github };
}

/** 批量统计多个目标的点赞总数（动态列表一次查询，返回 targetId → count） */
export async function countLikesByTargets(
  targetType: LikeTargetType,
  targetIds: string[],
): Promise<Record<string, number>> {
  const ids = [...new Set(targetIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = await db
    .select({ targetId: likes.targetId, n: count() })
    .from(likes)
    .where(and(eq(likes.targetType, targetType), inArray(likes.targetId, ids)))
    .groupBy(likes.targetId);
  const map: Record<string, number> = {};
  rows.forEach((r) => {
    map[r.targetId] = Number(r.n);
  });
  return map;
}

/** 某身份是否已赞某目标 */
export async function hasLiked(
  targetType: LikeTargetType,
  targetId: string,
  userType: LikeUserType,
  userIdent: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: likes.id })
    .from(likes)
    .where(
      and(
        eq(likes.targetType, targetType),
        eq(likes.targetId, targetId),
        eq(likes.userType, userType),
        eq(likes.userIdent, userIdent),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 切换点赞状态（幂等）
 *
 * @returns { liked, count } liked=操作后是否已赞，count=操作后总数
 */
export async function toggleLike(
  targetType: LikeTargetType,
  targetId: string,
  userType: LikeUserType,
  userIdent: string,
): Promise<{ liked: boolean; count: number }> {
  const existing = await db
    .select({ id: likes.id })
    .from(likes)
    .where(
      and(
        eq(likes.targetType, targetType),
        eq(likes.targetId, targetId),
        eq(likes.userType, userType),
        eq(likes.userIdent, userIdent),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    // 已赞 → 取消
    await db.delete(likes).where(eq(likes.id, existing[0].id));
    return { liked: false, count: await countLikes(targetType, targetId) };
  }
  // 未赞 → 点赞（唯一约束兜底，理论上不会冲突）
  await db.insert(likes).values({
    id: randomUUID(),
    targetType,
    targetId,
    userType,
    userIdent,
    createdAt: new Date(),
  });
  return { liked: true, count: await countLikes(targetType, targetId) };
}

/** 查询某目标全部点赞（供管理/调试） */
export async function listLikes(targetType: LikeTargetType, targetId: string): Promise<Like[]> {
  const rows = await db
    .select()
    .from(likes)
    .where(and(eq(likes.targetType, targetType), eq(likes.targetId, targetId)))
    .orderBy(likes.createdAt);
  return rows.map((r) => ({
    id: r.id,
    targetType: r.targetType as LikeTargetType,
    targetId: r.targetId,
    userType: r.userType as LikeUserType,
    userIdent: r.userIdent,
    createdAt: r.createdAt,
  }));
}
