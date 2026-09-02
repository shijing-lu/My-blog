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
import { headObject, r2Enabled } from '@/lib/object-storage';

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

/**
 * 探测一张照片对应的 R2 对象是否仍存在（用于过滤"DB 行存在但 R2 文件已删"的孤儿）
 *
 * 仅当 R2 已配置、URL 指向 R2 公开域时探测；非 R2（Vercel Blob / 外部直链）一律视为存活。
 * 设计目的：治本根因 A（数据层不过滤孤儿）；不可达/网络错误按"存活"处理，宁可多渲染
 * 一张破图也不误删（孤儿识别交由前端的内联 onerror 兜底）。
 *
 * **进程内 LRU 缓存**：默认 TTL 5 分钟，避免每次 SSR 渲染都对同一 key 重复 HEAD。
 * - 键：R2 对象 key（不含域名）
 * - 值：{ alive, ts }，alive=true 表示 200 OK / 不可达；false 表示 404
 * - 上限 500 项，超出按插入顺序淘汰；Vercel Serverless 进程复用可跨请求命中。
 * - 写入/删除路径（putPhoto/deletePhoto）无需主动失效缓存：TTL 到期自动刷新。
 *
 * @param photo 照片实体
 * @returns R2 对象是否 200 OK（不可达 = true）
 */
const ALIVE_TTL_MS = 5 * 60 * 1000;
const ALIVE_CACHE_MAX = 500;
const aliveCache = new Map<string, { alive: boolean; ts: number }>();

async function probeAlive(key: string): Promise<boolean> {
  const now = Date.now();
  const hit = aliveCache.get(key);
  if (hit && now - hit.ts < ALIVE_TTL_MS) return hit.alive;
  // 简单 LRU：超出上限时删最早插入的
  if (aliveCache.size >= ALIVE_CACHE_MAX) {
    const firstKey = aliveCache.keys().next().value;
    if (firstKey !== undefined) aliveCache.delete(firstKey);
  }
  const alive = await headObject(key);
  aliveCache.set(key, { alive, ts: now });
  return alive;
}

export async function isR2Alive(photo: Photo): Promise<boolean> {
  if (!r2Enabled()) return true;
  const url = photo.thumbUrl ?? photo.url ?? '';
  if (!url) return true;
  // 非 R2 域（Vercel Blob / 外部直链）跳过
  if (!/r2\.(dev|cloudflarestorage\.com)|byqx-blog\.online/i.test(url)) return true;
  let key: string;
  try {
    key = new URL(url).pathname.replace(/^\/+/, '');
  } catch {
    return true;
  }
  if (!key) return true;
  try {
    return await probeAlive(key);
  } catch {
    return true;
  }
}

/**
 * 列出"存活"照片（在 listPhotos 基础上按 R2 探测过滤孤儿）
 *
 * 实现策略：先多取一些（limit × 2 + 5 上限补偿），再并发探测 R2 存活，按原序截取 limit。
 * - **不修改 DB**：过滤仅作用于本次返回，供渲染层直接使用；
 * - **不走主备双写**：探测是只读 HEAD，不会触发回写；
 * - **批量并发**：用 Promise.all 把 R2 HEAD 串行→并发（46 张串行 ~10s，并发 ~1s）。
 *
 * 注：DB 物理清理（gc）由独立 API 端点（POST /api/photos/gc）负责，本函数只"过滤掉不显示"。
 *
 * @param limit 每页数量
 * @param offset 起始偏移
 * @param filter 筛选条件
 * @returns 仅含 R2 存活对象的照片实体数组（顺序与 listPhotos 一致）
 */
export async function listPhotosAlive(limit: number, offset: number, filter: PhotoFilter = {}): Promise<Photo[]> {
  if (!r2Enabled()) return listPhotos(limit, offset, filter);
  const want = Math.max(1, limit);
  const start = Math.max(0, offset);
  // 多取 2× + 5 张上限补偿（孤儿比例较低时足够；极端孤儿场景由前端分页兜底）
  const candidate = await listPhotos(want * 2 + 5, start, filter);
  const probed = await Promise.all(candidate.map(async (p) => ({ p, alive: await isR2Alive(p) })));
  const alive = probed.filter((x) => x.alive).map((x) => x.p);
  return alive.slice(0, want);
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
