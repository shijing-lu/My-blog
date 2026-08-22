/**
 * 相册照片数据访问层（业务逻辑 + 数据库读写）
 *
 * - 查询基于 sqlite schema 元数据构建，对 pg 同样生成合法 SQL（见 `db/index.ts` 注释）；
 * - 排序：展示日期 takenAt 倒序，同日按上传时间倒序；
 * - 时间线聚合在 JS 层完成（避免 SQLite/PG 日期函数方言差异），照片量级下无性能问题。
 */
import { count, desc, eq } from 'drizzle-orm';
import { photos } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { NewPhoto, Photo } from '../../db/types';

/** 数据库原始行类型 */
type PhotoRow = typeof photos.$inferSelect;

/** 行 → 实体（字段形状一致，直接透传） */
function mapRow(row: PhotoRow): Photo {
  return row;
}

/** 时间线节点 */
export interface TimelineItem {
  /** 日期（本地时区 YYYY-MM-DD） */
  date: string;
  /** 该日期照片数 */
  count: number;
}

/**
 * 时间线聚合（纯函数，可单测）：按本地时区把 takenAt 归并到日期，倒序
 *
 * @param rows 仅含 takenAt 的行
 * @returns 按日期倒序的时间线节点数组
 */
export function buildTimeline(rows: ReadonlyArray<{ takenAt: Date }>): TimelineItem[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const d = r.takenAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([date, countValue]) => ({ date, count: countValue }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * 分页列出照片（展示日期倒序，同日上传时间倒序）
 *
 * @param limit 每页数量
 * @param offset 起始偏移
 * @returns 照片实体数组
 */
export async function listPhotos(limit: number, offset: number): Promise<Photo[]> {
  const rows = await db
    .select()
    .from(photos)
    .orderBy(desc(photos.takenAt), desc(photos.createdAt))
    .limit(Math.max(1, limit))
    .offset(Math.max(0, offset));
  return rows.map(mapRow);
}

/** 照片总数 */
export async function countPhotos(): Promise<number> {
  const rows = await db.select({ n: count() }).from(photos);
  return rows[0]?.n ?? 0;
}

/** 按 id 查询照片 */
export async function getPhotoById(id: string): Promise<Photo | null> {
  const rows = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** 新增照片 */
export async function addPhoto(input: NewPhoto): Promise<Photo> {
  const rows = await db.insert(photos).values(input).returning();
  return mapRow(rows[0] as PhotoRow);
}

/** 更新照片元数据（标题/展示日期） */
export async function updatePhoto(
  id: string,
  patch: { title?: string; takenAt?: Date },
): Promise<Photo | null> {
  const rows = await db.update(photos).set(patch).where(eq(photos.id, id)).returning();
  return rows[0] ? mapRow(rows[0]) : null;
}

/** 删除照片，返回被删行（供调用方删除存储对象） */
export async function deletePhoto(id: string): Promise<Photo | null> {
  const rows = await db.delete(photos).where(eq(photos.id, id)).returning();
  return rows[0] ? mapRow(rows[0]) : null;
}

/** 时间线聚合数据（全部照片按日期统计，倒序） */
export async function getTimeline(): Promise<TimelineItem[]> {
  const rows = await db.select({ takenAt: photos.takenAt }).from(photos);
  return buildTimeline(rows);
}
