/**
 * 评论数据访问层（文章/动态通用，嵌套回复）
 *
 * - 顶级评论分页（默认 6 条/页），排序 hot（点赞数降序）/ latest（时间降序）；
 * - 每条顶级评论附带其全部回复（量小，一次取全按 parent_id 分组）；
 * - 评论点赞：likes 表记录去重，comments.like_count 冗余计数（"最热"排序用）。
 */
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { comments, likes } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { Comment, CommentTargetType, LikeUserType } from '../../db/types';

/** 校验目标类型 */
export function isCommentTargetType(value: unknown): value is CommentTargetType {
  return value === 'article' || value === 'moment';
}

/** 查看者身份（服务端解析自 cookie/请求） */
export interface CommentViewer {
  /** GitHub 登录用户（本站 id） */
  githubUserId: string | null;
  /** 匿名指纹 */
  fingerprint: string | null;
}

/** 单条评论对外形态 */
export interface CommentItem {
  id: string;
  parentId: string | null;
  content: string;
  authorType: 'anonymous' | 'github';
  authorName: string;
  githubLogin?: string;
  githubAvatar?: string;
  likeCount: number;
  liked: boolean;
  mine: boolean;
  createdAt: Date;
  /** 回复列表（仅顶级评论带） */
  replies?: CommentItem[];
}

/** 顶层评论总条数 */
export async function countTopComments(targetType: CommentTargetType, targetId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(comments)
    .where(and(eq(comments.targetType, targetType), eq(comments.targetId, targetId), isNull(comments.parentId)));
  return Number(rows[0]?.n ?? 0);
}

/** 构造单条对外形态（需 GitHub 用户信息映射） */
type CommentRowLike = Omit<Comment, 'targetType' | 'authorType'> & { targetType: string; authorType: string };
function toItem(
  c: CommentRowLike,
  liked: boolean,
  mine: boolean,
  ghMap: Map<string, { login: string; avatar: string }>,
): CommentItem {
  const item: CommentItem = {
    id: c.id,
    parentId: c.parentId,
    content: c.content,
    authorType: c.authorType as 'anonymous' | 'github',
    authorName: c.authorName,
    likeCount: c.likeCount,
    liked,
    mine,
    createdAt: c.createdAt,
  };
  if (c.authorType === 'github' && c.githubUserId) {
    const gh = ghMap.get(c.githubUserId);
    if (gh) {
      item.githubLogin = gh.login;
      item.githubAvatar = gh.avatar;
    }
  }
  return item;
}

/**
 * 分页取评论（顶级分页 + 每条附回复）
 *
 * @param page 1 起
 * @param pageSize 每页条数
 * @param sort hot=最热 | latest=最新
 * @param viewer 查看者身份（决定 liked/mine）
 */
export async function listComments(
  targetType: CommentTargetType,
  targetId: string,
  opts: { page: number; pageSize: number; sort: 'hot' | 'latest' },
  viewer: CommentViewer | null,
): Promise<{ comments: CommentItem[]; total: number; hasMore: boolean }> {
  const { page, pageSize, sort } = opts;
  const offset = Math.max(0, (page - 1) * pageSize);

  const order = sort === 'hot' ? [desc(comments.likeCount), desc(comments.createdAt)] : [desc(comments.createdAt)];
  const baseWhere = and(eq(comments.targetType, targetType), eq(comments.targetId, targetId));

  // 顶级评论（分页，多取 1 判断 hasMore）
  const tops = await db
    .select()
    .from(comments)
    .where(and(baseWhere, isNull(comments.parentId)))
    .orderBy(...order)
    .limit(pageSize + 1)
    .offset(offset);
  const hasMore = tops.length > pageSize;
  const topList = tops.slice(0, pageSize);

  // 全部回复（一次取全，按 parent_id 分组）
  const allReplies = await db
    .select()
    .from(comments)
    .where(and(baseWhere, sql`${comments.parentId} IS NOT NULL`))
    .orderBy(asc(comments.createdAt));
  const repliesByParent = new Map<string, CommentRowLike[]>();
  allReplies.forEach((r) => {
    if (!r.parentId) return;
    const list = repliesByParent.get(r.parentId) ?? [];
    list.push(r);
    repliesByParent.set(r.parentId, list);
  });

  // GitHub 作者信息映射
  const ghIds = [...new Set([...topList, ...allReplies].map((c) => c.githubUserId).filter(Boolean) as string[])];
  const ghMap = await buildGithubMap(ghIds);

  // 当前查看者已赞的评论集合
  const commentIds = [...topList.map((c) => c.id), ...allReplies.map((c) => c.id)];
  const likedIds = await likedCommentIds(commentIds, viewer);

  // mine：仅 GitHub 用户自己的评论（匿名评论不提供删除）
  const viewerUid = viewer?.githubUserId ?? null;

  const total = await countTopComments(targetType, targetId);
  const result: CommentItem[] = topList.map((c) => {
    const item = toItem(c, likedIds.has(c.id), viewerUid !== null && c.githubUserId === viewerUid, ghMap);
    item.replies = (repliesByParent.get(c.id) ?? []).map((r) =>
      toItem(r, likedIds.has(r.id), viewerUid !== null && r.githubUserId === viewerUid, ghMap),
    );
    return item;
  });

  return { comments: result, total, hasMore };
}

/** GitHub 用户 id → { login, avatar } */
async function buildGithubMap(ids: string[]): Promise<Map<string, { login: string; avatar: string }>> {
  const map = new Map<string, { login: string; avatar: string }>();
  if (ids.length === 0) return map;
  const { githubUsers } = await import('../../db/schema.sqlite');
  const rows = await db
    .select({ id: githubUsers.id, login: githubUsers.login, avatarUrl: githubUsers.avatarUrl })
    .from(githubUsers)
    .where(inArray(githubUsers.id, ids));
  rows.forEach((r) => map.set(r.id, { login: r.login, avatar: r.avatarUrl }));
  return map;
}

/** 查看者已赞的评论 id 集合 */
async function likedCommentIds(commentIds: string[], viewer: CommentViewer | null): Promise<Set<string>> {
  const set = new Set<string>();
  if (!viewer || commentIds.length === 0) return set;
  const identFilter =
    viewer.githubUserId !== null
      ? and(eq(likes.userType, 'github'), eq(likes.userIdent, viewer.githubUserId))
      : and(eq(likes.userType, 'anonymous'), eq(likes.userIdent, viewer.fingerprint ?? ''));
  if (!identFilter) return set;
  const rows = await db
    .select({ targetId: likes.targetId })
    .from(likes)
    .where(and(eq(likes.targetType, 'comment'), inArray(likes.targetId, commentIds), identFilter));
  rows.forEach((r) => set.add(r.targetId));
  return set;
}

/** 创建评论 */
export async function addComment(input: {
  targetType: CommentTargetType;
  targetId: string;
  parentId: string | null;
  content: string;
  authorType: 'anonymous' | 'github';
  authorName: string;
  githubUserId: string | null;
}): Promise<Comment> {
  const rows = await db
    .insert(comments)
    .values({
      id: randomUUID(),
      targetType: input.targetType,
      targetId: input.targetId,
      parentId: input.parentId,
      content: input.content,
      authorType: input.authorType,
      authorName: input.authorName,
      githubUserId: input.githubUserId,
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as Comment;
}

/** 按 id 取评论 */
export async function getCommentById(id: string): Promise<Comment | null> {
  const rows = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  return (rows[0] as Comment | undefined) ?? null;
}

/** 删除评论及其全部回复 */
export async function deleteComment(id: string): Promise<void> {
  await db.delete(comments).where(eq(comments.id, id));
  await db.delete(comments).where(eq(comments.parentId, id));
}

/** 评论点赞 toggle：likes 表去重 + 同步 like_count（应用层计算，跨方言兼容） */
export async function toggleCommentLike(
  commentId: string,
  userType: LikeUserType,
  userIdent: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const existing = await db
    .select({ id: likes.id })
    .from(likes)
    .where(
      and(
        eq(likes.targetType, 'comment'),
        eq(likes.targetId, commentId),
        eq(likes.userType, userType),
        eq(likes.userIdent, userIdent),
      ),
    )
    .limit(1);

  // 当前 likeCount
  const cur = await db
    .select({ c: comments.likeCount })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  const current = cur[0]?.c ?? 0;

  if (existing.length > 0 && existing[0]) {
    // 取消
    await db.delete(likes).where(eq(likes.id, existing[0].id));
    const next = Math.max(0, current - 1);
    await db.update(comments).set({ likeCount: next }).where(eq(comments.id, commentId));
    return { liked: false, likeCount: next };
  }

  // 点赞
  await db.insert(likes).values({
    id: randomUUID(),
    targetType: 'comment',
    targetId: commentId,
    userType,
    userIdent,
    createdAt: new Date(),
  });
  const next = current + 1;
  await db.update(comments).set({ likeCount: next }).where(eq(comments.id, commentId));
  return { liked: true, likeCount: next };
}
