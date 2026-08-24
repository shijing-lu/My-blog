/**
 * GitHub 登录用户数据访问层
 *
 * 每次 OAuth 登录 upsert（按 github_id），返回本站 uuid 供 user_session 使用；
 * 评论/点赞通过 user_session 的 uid 关联到该用户（头像/昵称展示）。
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { githubUsers } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { GithubUser } from '../../db/types';

/** 按 github_id upsert 用户，返回本站实体（含本站 uuid） */
export async function upsertGithubUser(input: {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}): Promise<GithubUser> {
  const existing = await db
    .select()
    .from(githubUsers)
    .where(eq(githubUsers.githubId, input.githubId))
    .limit(1);
  if (existing[0]) {
    // 更新昵称/头像（登录名/ID 不变）
    const rows = await db
      .update(githubUsers)
      .set({
        login: input.login,
        name: input.name ?? '',
        avatarUrl: input.avatarUrl ?? '',
      })
      .where(eq(githubUsers.githubId, input.githubId))
      .returning();
    const r = rows[0] as GithubUser;
    return r;
  }
  const rows = await db
    .insert(githubUsers)
    .values({
      id: randomUUID(),
      githubId: input.githubId,
      login: input.login,
      name: input.name ?? '',
      avatarUrl: input.avatarUrl ?? '',
      createdAt: new Date(),
    })
    .returning();
  return rows[0] as GithubUser;
}

/** 按本站 id 查用户 */
export async function getGithubUserById(id: string): Promise<GithubUser | null> {
  const rows = await db.select().from(githubUsers).where(eq(githubUsers.id, id)).limit(1);
  return (rows[0] as GithubUser | undefined) ?? null;
}
