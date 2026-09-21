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
import { renderMarkdownHtml, renderMdx } from './mdx';
import { collectImageIdsFromHtml, getImageSizes, injectImageSizeAttrs } from './images';
import type { Moment, MomentMedia, MomentVisibility } from '../../db/types';

/** 媒体类型白名单 */
export const MEDIA_TYPES = ['image', 'gif', 'video'] as const;

/** 可见性白名单：public 公开（所有人可见）/ private 私密（仅管理员可见） */
export const MOMENT_VISIBILITIES = ['public', 'private'] as const;

/** 可见性入参规整（纯函数，可单测）：非法值回落 public */
export function normalizeVisibility(v: unknown): MomentVisibility {
  return v === 'private' ? 'private' : 'public';
}

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

/** 行 → 实体（visibility 规整白名单，库中脏值回落 public） */
function mapRow(row: typeof moments.$inferSelect): Moment {
  return {
    ...row,
    media: parseMedia(row.media),
    tags: parseTags(row.tags),
    visibility: normalizeVisibility(row.visibility),
  };
}

/** 动态列表筛选条件 */
export interface MomentFilter {
  /** 按标签精确匹配（JSON 内 '"tag"' 子串） */
  tag?: string;
  /** 关键词：内容 / 标签 模糊匹配（大小写不敏感） */
  q?: string;
  /** 日期 YYYY-MM-DD：按当天过滤 */
  date?: string;
  /** 是否包含私密动态（仅管理员视角传 true；默认只列公开） */
  includePrivate?: boolean;
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
  // 普通访客只见公开动态；管理员（includePrivate）可见全部
  if (!filter.includePrivate) {
    conds.push(eq(moments.visibility, 'public'));
  }
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

/** 新增动态（visibility 默认 public） */
export async function addMoment(
  content: string,
  media: MomentMedia[],
  tags: string[] = [],
  visibility: MomentVisibility = 'public',
): Promise<Moment> {
  const now = new Date();
  const rows = await db
    .insert(moments)
    .values({
      id: randomUUID(),
      content,
      media: serializeMedia(media),
      tags: serializeTags(tags),
      visibility,
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

/** 更新动态（内容 + 媒体 + 标签 + 可见性） */
export async function updateMoment(
  id: string,
  patch: { content?: string; media?: MomentMedia[]; tags?: string[]; visibility?: MomentVisibility },
): Promise<Moment | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.content !== undefined) set.content = patch.content.trim().slice(0, MAX_CONTENT);
  if (patch.media !== undefined) set.media = serializeMedia(patch.media);
  if (patch.tags !== undefined) set.tags = serializeTags(patch.tags);
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  const rows = await db.update(moments).set(set).where(eq(moments.id, id)).returning();
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * 全量标签聚合（按使用频次降序，同频按名称升序）。
 *
 * 用于动态页筛选栏：此前筛选 chips 由前端从「已加载进 DOM 的卡片」收集，
 * 首屏只有第一页（20 条），未加载动态的标签全部缺失（表现为"标签显示不全"）。
 * 改为服务端聚合全部动态的标签，前端拿到的即为完整集合。
 */
export async function getAllMomentTags(includePrivate = false): Promise<Array<{ tag: string; count: number }>> {
  const rows = await db.select({ tags: moments.tags, visibility: moments.visibility }).from(moments);
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!includePrivate && r.visibility !== 'public') continue;
    for (const t of parseTags(r.tags)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'),
  );
}

/** 动态日期时间线（按天聚合；includePrivate=false 时仅统计公开动态） */
export async function getMomentTimeline(includePrivate = false): Promise<Array<{ date: string; count: number }>> {  const rows = await db
    .select({ createdAt: moments.createdAt, visibility: moments.visibility })
    .from(moments)
    .orderBy(desc(moments.createdAt));
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!includePrivate && r.visibility !== 'public') continue;
    // 按北京时间聚合（服务器可能为 UTC，直接 getFullYear/getDate 会把凌晨动态归到前一天）
    const p = bjParts(r.createdAt);
    const key = `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map, ([date, count]) => ({ date, count }));
}

/** 动态对外视图：raw content + tags + 服务端渲染的 Markdown HTML */
export interface MomentView extends Moment {
  /** Markdown 渲染后的 HTML（与文章/文档同一套完整管线 renderMdx；XSS 安全同源） */
  contentHtml: string;
}

/**
 * Moment → 对外视图（含服务端渲染的 Markdown HTML）。
 *
 * ## ⚠️ 2026-09-20 管线统一（用户诉求：动态与文章/文档语法一致、预览与展示对齐）
 *
 * 原先走 `renderMarkdownHtml`（仅 remark-gfm + remark-rehype 四插件）→ 动态里写
 * 数学公式 / `:::note` 容器 / Callout / 荧光高亮 / 黑幕 全部**原样泄漏或不渲染**，
 * 与文章、文档的展示能力割裂。现改为 `renderMdx`——**与文章页/文档页完全同一套
 * 解析管线与扩展配置**（normalizeSource 预处理 + remark/rehype 全插件链 + 组件注册表），
 * 不再有第二套实现。
 *
 * 渲染原则不变：SSR 首屏、load-more、编辑预览一律用本函数在服务端产出 `contentHtml`，
 * 前端只 `set:html` 这份服务端结果，绝不用原始 content 在前端拼 HTML。
 *
 * 性能（实测 .diag/moments-render-bench.ts）：动态 ≤2000 字，冷渲染 60~70ms/条，
 * 列表页 20 条并发冷渲染 365ms，二次请求命中 renderMdx 的 LRU（~1ms）——开销可接受。
 * 图片宽高注入与文章页同款（正文内嵌 DB 图片时避免懒加载宽度跳变）。
 */
/**
 * 动态正文渲染（**唯一实现**）：列表首屏、加载更多分页、编辑预览全部走这里。
 *
 * 与文章页/文档页同一套 `renderMdx` 管线（见 toMomentView 注释），并复刻文章页的
 * 图片宽高注入（正文内嵌 DB 图片时避免懒加载宽度跳变）——保证「编辑预览所见」
 * 与「发布后卡片展示」逐字节一致（同一函数、同一后处理）。
 *
 * ## 容错降级（必须有，勿删）
 *
 * `renderMdx` 是 MDX 编译管线：**畸形 HTML 会抛错**（实测 `<img src=x onerror=1>` →
 * `Unexpected character before attribute value`；`<img ... onerror="...">` → 缺闭合标签），
 * 而动态是随手输入的短内容、且一页要渲染 20 条——任何一条语法问题都**不能**让整页 500。
 * 因此渲染失败时降级到轻量 GFM 管线（`renderMarkdownHtml`，等价迁移前的旧行为），
 * 并在服务端日志留痕。预览接口同样走本函数，故「预览看到的」与「发布后展示的」在
 * 降级路径下也保持一致。
 */
export async function renderMomentContent(content: string): Promise<string> {
  try {
    const { html } = await renderMdx(content);
    const ids = collectImageIdsFromHtml(html);
    if (ids.length === 0) return html;
    const sizes = await getImageSizes(ids);
    return sizes.size > 0 ? injectImageSizeAttrs(html, sizes) : html;
  } catch (err) {
    console.error('[moments] renderMdx 失败，降级为轻量 GFM 管线：', err);
    return renderMarkdownHtml(content);
  }
}

export async function toMomentView(m: Moment): Promise<MomentView> {
  return { ...m, contentHtml: await renderMomentContent(m.content) };
}

/** 北京时间部件（服务器时区无关：Vercel 实例为 UTC，直接用 getHours/getDate 会差 8 小时） */
const BJ_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

interface BjParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function bjParts(d: Date): BjParts {
  const parts = Object.fromEntries(BJ_FMT.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
  const h = parts.hour === '24' ? 0 : Number(parts.hour); // en-US hour12:false 可能输出 24:xx
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h, mi: Number(parts.minute) };
}

/** 北京时间天数序号（跨月/跨年安全） */
function bjDayNo(p: BjParts): number {
  return Date.UTC(p.y, p.mo - 1, p.d) / 86400000;
}

/**
 * 北京时间完整格式 YYYY-MM-DD HH:mm（卡片时间悬停提示用）
 */
export function formatMomentFullTime(d: Date): string {
  const p = bjParts(d);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

/**
 * 相对时间文案（纯函数，可单测；「当天/昨天/HH:mm/日期」一律按北京时间判断与格式化）
 * 刚刚 / N 分钟前 / N 小时前（当天）/ 昨天 HH:mm / N 天前 / YYYY-MM-DD
 */
export function formatRelativeTime(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const b = bjParts(date);
  if (diffMs < 0) {
    return `${b.y}-${pad(b.mo)}-${pad(b.d)}`;
  }
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  const n = bjParts(now);
  if (bjDayNo(b) === bjDayNo(n)) return `${hours} 小时前`;
  if (bjDayNo(n) - bjDayNo(b) === 1) {
    return `昨天 ${pad(b.h)}:${pad(b.mi)}`;
  }
  if (hours < 24 * 7) return `${Math.floor(hours / 24)} 天前`;
  return `${b.y}-${pad(b.mo)}-${pad(b.d)}`;
}
