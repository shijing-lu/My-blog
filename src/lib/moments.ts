/**
 * 动态数据访问层（动态圈，公开浏览）
 *
 * - media 以 JSON 文本存储（双方言一致）：[{type:'image'|'gif'|'video', url, poster?}]；
 * - tags 以 JSON 文本存储：string[]（搜索/筛选/时间线归类用）；
 * - 评论/点赞预留：moments.id 为稳定关联键，后续新增 comments/likes 表挂接，
 *   GET 返回结构预留扩展位（likeCount/commentCount）。
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, like, lt, or } from 'drizzle-orm';
import { moments } from '../../db/schema.sqlite';
import { db } from '../../db';
import { renderMarkdownHtml } from './mdx';
import type { Moment, MomentMedia } from '../../db/types';

/** 媒体类型白名单 */
export const MEDIA_TYPES = ['image', 'gif', 'video'] as const;

/** 标签数量上限 / 单标签长度上限 / 内容长度上限 */
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 20;
export const MAX_CONTENT = 2000;

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

/** tags JSON → 数组（仅字符串，上限 MAX_TAGS） */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === 'string').slice(0, MAX_TAGS)
      : [];
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
    if (v === '' || seen.has(v)) continue;
    seen.add(v);
    clean.push(v);
    if (clean.length >= MAX_TAGS) break;
  }
  return JSON.stringify(clean);
}

/** 行 → 实体 */
function mapRow(row: typeof moments.$inferSelect): Moment {
  return { ...row, media: parseMedia(row.media), tags: parseTags(row.tags) };
}

/** 动态列表筛选条件 */
export interface MomentFilter {
  /** 按标签精确匹配（JSON 内 '"tag"' 子串） */
  tag?: string;
  /** 关键词：内容 / 标签 模糊匹配（大小写不敏感） */
  q?: string;
  /** 日期 YYYY-MM-DD：按当天过滤 */
  date?: string;
}

/** 时间补零 */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 分页列出动态（时间倒序，可选筛选）
 *
 * @param limit 每页数量
 * @param offset 起始偏移
 * @param filter tag / q / date 筛选
 */
export async function listMoments(limit: number, offset: number, filter: MomentFilter = {}): Promise<Moment[]> {
  const conds = [];
  if (filter.tag) {
    conds.push(like(moments.tags, `%"${filter.tag}"%`));
  }
  if (filter.q) {
    const q = filter.q;
    conds.push(or(like(moments.content, `%${q}%`), like(moments.tags, `%${q}%`)));
  }
  if (filter.date) {
    const [y, m, d] = filter.date.split('-').map(Number);
    if (y && m && d) {
      const start = new Date(y, m - 1, d);
      const end = new Date(y, m - 1, d + 1);
      conds.push(gte(moments.createdAt, start), lt(moments.createdAt, end));
    }
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  const rows = await db
    .select()
    .from(moments)
    .where(where)
    .orderBy(desc(moments.createdAt))
    .limit(Math.max(1, limit))
    .offset(Math.max(0, offset));
  return rows.map(mapRow);
}

/** 新增动态 */
export async function addMoment(content: string, media: MomentMedia[], tags: string[] = []): Promise<Moment> {
  const now = new Date();
  const rows = await db
    .insert(moments)
    .values({
      id: randomUUID(),
      content,
      media: serializeMedia(media),
      tags: serializeTags(tags),
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

/** 按 id 取单条动态 */
export async function getMoment(id: string): Promise<Moment | null> {
  const rows = await db.select().from(moments).where(eq(moments.id, id)).limit(1);
  return rows[0] ? mapRow(rows[0] as typeof moments.$inferSelect) : null;
}

/** 更新动态（内容 + 标签） */
export async function updateMoment(
  id: string,
  patch: { content?: string; tags?: string[] },
): Promise<Moment | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.content !== undefined) set.content = patch.content.trim().slice(0, MAX_CONTENT);
  if (patch.tags !== undefined) set.tags = serializeTags(patch.tags);
  const rows = await db.update(moments).set(set).where(eq(moments.id, id)).returning();
  return rows[0] ? mapRow(rows[0] as typeof moments.$inferSelect) : null;
}

/** 动态日期时间线（按天聚合，仅取 createdAt 列；数量少，JS 聚合即可跨方言） */
export async function getMomentTimeline(): Promise<Array<{ date: string; count: number }>> {
  const rows = await db
    .select({ createdAt: moments.createdAt })
    .from(moments)
    .orderBy(desc(moments.createdAt));
  const map = new Map<string, number>();
  for (const r of rows) {
    const d = r.createdAt;
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map, ([date, count]) => ({ date, count }));
}

/** 动态对外视图：raw content + tags + 服务端渲染的 Markdown HTML */
export interface MomentView extends Moment {
  /** Markdown 渲染后的 HTML（remark-gfm 纯 Markdown 管线，XSS 安全） */
  contentHtml: string;
}

/**
 * Moment → 对外视图（含服务端渲染的 Markdown HTML）。
 *
 * 渲染原则：SSR 首屏、load-more、预览一律用同一份 `renderMarkdownHtml`
 * 在服务端产出 `contentHtml`，前端只 `set:html` 这份服务端结果，绝不用
 * 原始 content 在前端拼 HTML（与日记渲染先例一致）。
 */
export async function toMomentView(m: Moment): Promise<MomentView> {
  return { ...m, contentHtml: await renderMarkdownHtml(m.content) };
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
