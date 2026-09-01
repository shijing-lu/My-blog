/**
 * 相册照片数据访问层（业务逻辑 + 数据库读写）
 *
 * - 查询基于 sqlite schema 元数据构建，对 pg 同样生成合法 SQL（见 `db/index.ts` 注释）；
 * - 排序：展示日期 takenAt 倒序，同日按上传时间倒序；
 * - 时间线聚合在 JS 层完成（避免 SQLite/PG 日期函数方言差异），照片量级下无性能问题；
 * - tags 以 JSON 文本存储（string[]），上传时可设置、影集页可过滤、可批量维护。
 */
import { and, count, desc, eq, like } from 'drizzle-orm';
import { photos } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { NewPhoto, Photo } from '../../db/types';

/** 数据库原始行类型 */
type PhotoRow = typeof photos.$inferSelect;

/** 标签数量上限 / 单标签长度上限 */
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 20;

/** tags JSON → 数组 */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p: unknown = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string').slice(0, MAX_TAGS) : [];
  } catch {
    return [];
  }
}

/** tags 数组 → JSON 文本（去空白、去重、限长） */
export function serializeTags(tags: string[]): string {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const t of tags) {
    const v = t.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    clean.push(v);
    if (clean.length >= MAX_TAGS) break;
  }
  return JSON.stringify(clean);
}

/** 行 → 实体（tags 反序列化） */
function mapRow(row: PhotoRow): Photo {
  return { ...row, tags: parseTags(row.tags) };
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

/** 照片列表筛选 */
export interface PhotoFilter {
  /** 按标签过滤（JSON 内 '"tag"' 子串匹配） */
  tag?: string;
}

/**
 * 分页列出照片（展示日期倒序，同日上传时间倒序；可选按标签过滤）
 *
 * @param limit 每页数量
 * @param offset 起始偏移
 * @param filter 筛选条件
 * @returns 照片实体数组
 */
export async function listPhotos(limit: number, offset: number, filter: PhotoFilter = {}): Promise<Photo[]> {
  const where = filter.tag ? like(photos.tags, `%"${filter.tag}"%`) : undefined;
  const rows = await db
    .select()
    .from(photos)
    .where(where)
    .orderBy(desc(photos.takenAt), desc(photos.createdAt))
    .limit(Math.max(1, limit))
    .offset(Math.max(0, offset));
  return rows.map(mapRow);
}

/** 照片总数（可选按标签过滤） */
export async function countPhotos(filter: PhotoFilter = {}): Promise<number> {
  const where = filter.tag ? like(photos.tags, `%"${filter.tag}"%`) : undefined;
  const rows = await db.select({ n: count() }).from(photos).where(where);
  return rows[0]?.n ?? 0;
}

/** 按 id 查询照片 */
export async function getPhotoById(id: string): Promise<Photo | null> {
  const rows = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** 新增照片（tags 序列化入库） */
export async function addPhoto(input: NewPhoto): Promise<Photo> {
  const { tags, ...rest } = input;
  const rows = await db
    .insert(photos)
    .values({ ...rest, tags: serializeTags(tags ?? []) })
    .returning();
  return mapRow(rows[0] as PhotoRow);
}

/** 更新照片元数据（标题/展示日期/标签） */
export async function updatePhoto(
  id: string,
  patch: { title?: string; takenAt?: Date; tags?: string[] },
): Promise<Photo | null> {
  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.takenAt !== undefined) set.takenAt = patch.takenAt;
  if (patch.tags !== undefined) set.tags = serializeTags(patch.tags);
  const rows = await db.update(photos).set(set).where(eq(photos.id, id)).returning();
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

/** 全站照片标签聚合（去重 + 计数，供筛选 chips） */
export async function getPhotoTags(): Promise<Array<{ tag: string; count: number }>> {
  const rows = await db.select({ tags: photos.tags }).from(photos);
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const t of parseTags(r.tags)) {
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * 批量维护标签
 * @param ids 目标照片 id
 * @param op set=覆盖为给定标签 / add=合并追加 / remove=减去给定标签
 * @param tags 标签集合（remove 时为空 → 无操作；清空请用 set: []）
 * @returns 实际更新的照片数
 */
export async function batchUpdateTags(ids: string[], op: 'set' | 'add' | 'remove', tags: string[]): Promise<number> {
  const clean = tags.map((t) => t.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN)).filter(Boolean);
  let updated = 0;
  for (const id of ids) {
    const photo = await getPhotoById(id);
    if (!photo) continue;
    let next: string[];
    if (op === 'set') next = clean;
    else if (op === 'add') next = [...new Set([...photo.tags, ...clean])];
    else next = photo.tags.filter((t) => !clean.includes(t));
    const rows = await db
      .update(photos)
      .set({ tags: serializeTags(next) })
      .where(eq(photos.id, id))
      .returning();
    if (rows[0]) updated += 1;
  }
  return updated;
}
