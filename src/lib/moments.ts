/**
 * 动态数据访问层（动态圈，公开浏览）
 *
 * - media 以 JSON 文本存储（双方言一致）：[{type:'image'|'gif'|'video', url, poster?}]；
 * - 评论/点赞预留：moments.id 为稳定关联键，后续新增 comments/likes 表挂接，
 *   GET 返回结构预留扩展位（likeCount/commentCount）。
 */
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { moments } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { Moment, MomentMedia } from '../../db/types';

/** 媒体类型白名单 */
export const MEDIA_TYPES = ['image', 'gif', 'video'] as const;

/** 校验单个媒体项 */
export function isValidMedia(m: unknown): m is MomentMedia {
  if (typeof m !== 'object' || m === null) return false;
  const obj = m as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    (MEDIA_TYPES as readonly string[]).includes(obj.type) &&
    typeof obj.url === 'string' &&
    obj.url.trim() !== '' &&
    obj.url.length <= 2048
  );
}

/** media JSON → 数组（非法项剔除） */
export function parseMedia(raw: string | null | undefined): MomentMedia[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidMedia) : [];
  } catch {
    return [];
  }
}

/** media 数组 → JSON 文本 */
export function serializeMedia(media: MomentMedia[]): string {
  return JSON.stringify(media.filter(isValidMedia));
}

/** 行 → 实体 */
function mapRow(row: typeof moments.$inferSelect): Moment {
  return { ...row, media: parseMedia(row.media) };
}

/**
 * 分页列出动态（时间倒序）
 *
 * @param limit 每页数量
 * @param offset 起始偏移
 */
export async function listMoments(limit: number, offset: number): Promise<Moment[]> {
  const rows = await db
    .select()
    .from(moments)
    .orderBy(desc(moments.createdAt))
    .limit(Math.max(1, limit))
    .offset(Math.max(0, offset));
  return rows.map(mapRow);
}

/** 新增动态（评论/点赞计数预留字段后续补充） */
export async function addMoment(content: string, media: MomentMedia[]): Promise<Moment> {
  const now = new Date();
  const rows = await db
    .insert(moments)
    .values({
      id: randomUUID(),
      content,
      media: serializeMedia(media),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapRow(rows[0] as typeof moments.$inferSelect);
}

/** 删除动态 */
export async function deleteMoment(id: string): Promise<Moment | null> {
  const rows = await db.delete(moments).where(eq(moments.id, id)).returning();
  return rows[0] ? mapRow(rows[0]) : null;
}

/** 时间补零 */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 是否为同一天 */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 相对时间文案（纯函数，可单测）
 * 刚刚 / N 分钟前 / N 小时前（当天）/ 昨天 HH:mm / N 天前 / YYYY-MM-DD
 */
export function formatRelativeTime(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (sameDay(date, now)) return `${hours} 小时前`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) {
    return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (hours < 24 * 7) return `${Math.floor(hours / 24)} 天前`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
