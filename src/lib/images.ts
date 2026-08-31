/**
 * 图片服务（低耦合模块）
 *
 * - `storeImage` / `getImage`：上传图片以 **base64 文本**存入 DB（SQLite/PG 的 text 列，
 *   双方言一致），兼容 Vercel Serverless（无本地磁盘）部署；
 * - `extractFirstImage`：从文章 MDX 源码提取第一张图片 URL（首页卡片封面用）；
 * - `ALLOWED_MIME` / `MAX_IMAGE_BYTES`：上传校验白名单与大小上限。
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { images } from '../../db/schema.sqlite';
import { db } from '../../db';

/** 存储的图片实体（data 为 base64 编码的二进制） */
export interface StoredImage {
  id: string;
  mime: string;
  data: string;
}

/** 允许的图片 MIME 类型 */
export const ALLOWED_MIME = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/;

/** 单张图片大小上限：5MB（解码后字节数） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 校验上传参数，返回错误信息或 null */
export function validateImageUpload(mime: unknown, base64: unknown, byteLength: number): string | null {
  if (typeof mime !== 'string' || !ALLOWED_MIME.test(mime)) {
    return '仅支持 PNG / JPG / GIF / WebP / AVIF / SVG 图片';
  }
  if (typeof base64 !== 'string' || base64.length === 0) {
    return '缺少图片数据';
  }
  if (byteLength === 0) {
    return '图片内容为空';
  }
  if (byteLength > MAX_IMAGE_BYTES) {
    return '图片不能超过 5MB';
  }
  return null;
}

/** 保存一张图片（data 为 base64），返回存储实体 */
export async function storeImage(mime: string, dataBase64: string): Promise<StoredImage> {
  const id = randomUUID();
  await db.insert(images).values({ id, mime, data: dataBase64, createdAt: new Date() });
  return { id, mime, data: dataBase64 };
}

/** 按 id 读取图片（供公开路由 /api/images/[id] 输出） */
export async function getImage(id: string): Promise<StoredImage | null> {
  const rows = await db.select().from(images).where(eq(images.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, mime: row.mime, data: row.data };
}

/** 从 MDX 源码提取第一张图片 URL（无则 null） */
export function extractFirstImage(content: string): string | null {
  const match = content.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  return match?.[1] ?? null;
}

/**
 * 卡片封面缩略图 URL：对 DB 图片（/api/images/<id>）追加 `?w=600&f=webp`，
 * 由路由按需缩放/转 WebP → 卡片只需 ~600px，不再加载 2MB 原图，显著降 LCP 与字节。
 *
 * - 仅优化本站 `/api/images/` 路由的图片；外部 URL（Vercel Blob / 图床直链）原样返回，
 *   其优化见后续 Vercel `/_vercel/image` 接入（P3）。
 * - 已带查询串时追加而非覆盖。
 */
const CARD_WIDTH = 600;
export function cardCoverUrl(cover: string | null | undefined): string | null {
  if (!cover) return null;
  if (!cover.startsWith('/api/images/')) return cover;
  const sep = cover.includes('?') ? '&' : '?';
  return `${cover}${sep}w=${CARD_WIDTH}&f=webp`;
}
