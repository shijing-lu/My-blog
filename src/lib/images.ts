/**
 * 图片服务（低耦合模块）
 *
 * - `storeImage` / `getImage`：图片默认存 **Cloudflare R2**（对象存储），DB 只存元数据。
 *   未配置 R2 时回落 base64 存库（兼容本地/降级）。
 * - 上传时用 sharp 生成「全尺寸(1920 webp) + 缩略图(600 webp)」两档直传 R2，
 *   从而封面/列表直接用缩略图、详情用全图，保留 P0 的体积优化并脱离 DB 热路径。
 * - `extractFirstImage`：从文章 MDX 源码提取第一张图片 URL（首页卡片封面用）；
 * - `ALLOWED_MIME` / `MAX_IMAGE_BYTES`：上传校验白名单与大小上限。
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { images } from '../../db/schema.sqlite';
import { db } from '../../db';
import { r2Enabled, putObject } from '@/lib/object-storage';
import { isTransformableInput, imageMeta, resizeToWebp } from '@/lib/image-transform';

/** 存储的图片实体（data 为兼容旧数据的 base64；新图为空，走 R2 key/url） */
export interface StoredImage {
  id: string;
  mime: string;
  /** base64 编码的二进制（旧数据；新图为 ''） */
  data: string;
  /** R2 原图对象 key */
  key: string | null;
  /** R2 原图公开 URL */
  url: string | null;
  /** R2 缩略图对象 key */
  thumbKey: string | null;
  /** R2 缩略图公开 URL */
  thumbUrl: string | null;
  /** 原图宽度 */
  width: number | null;
  /** 原图高度 */
  height: number | null;
  /** 字节数 */
  size: number | null;
}

/** 允许的图片 MIME 类型 */
export const ALLOWED_MIME = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/;

/** 单张图片大小上限：5MB（解码后字节数） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 全尺寸/缩略图目标宽度（webp） */
const FULL_WIDTH = 1920;
const THUMB_WIDTH = 600;

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

/** 保存一张图片：R2 优先（生成两档 webp），失败回落 base64 */
export async function storeImage(mime: string, dataBase64: string): Promise<StoredImage> {
  const id = randomUUID();
  const buffer = Buffer.from(dataBase64, 'base64');

  // R2 已配置且图片可处理 → 上传两档变体
  if (r2Enabled() && isTransformableInput(mime)) {
    try {
      const full = await resizeToWebp(buffer, FULL_WIDTH);
      const thumb = await resizeToWebp(buffer, THUMB_WIDTH);
      const key = `images/${id}`;
      const thumbKey = `images/${id}_thumb`;
      const url = await putObject(key, { buffer: full.buffer, contentType: 'image/webp' });
      const thumbUrl = await putObject(thumbKey, { buffer: thumb.buffer, contentType: 'image/webp' });
      const row = {
        id,
        mime,
        data: '',
        key,
        url,
        thumbKey,
        thumbUrl,
        width: full.width,
        height: full.height,
        size: full.buffer.length,
        createdAt: new Date(),
      };
      await db.insert(images).values(row);
      return row as StoredImage;
    } catch (err) {
      // R2 上传失败：回落 base64 存库，保证上传不报错
      console.error('[storeImage] R2 上传失败，回落 base64:', err);
      await db.insert(images).values({ id, mime, data: dataBase64, createdAt: new Date() });
      return { id, mime, data: dataBase64, key: null, url: null, thumbKey: null, thumbUrl: null, width: null, height: null, size: buffer.length };
    }
  }

  // SVG 或未配置 R2：原样存库（SVG 为矢量不走 sharp；R2 未配置走 base64 降级）
  if (r2Enabled() && mime === 'image/svg+xml') {
    try {
      const key = `images/${id}`;
      const url = await putObject(key, { buffer, contentType: 'image/svg+xml' });
      const dims = await imageMeta(buffer);
      const row = {
        id,
        mime,
        data: '',
        key,
        url,
        thumbKey: null,
        thumbUrl: null,
        width: dims.width,
        height: dims.height,
        size: buffer.length,
        createdAt: new Date(),
      };
      await db.insert(images).values(row);
      return row as StoredImage;
    } catch (err) {
      console.error('[storeImage] R2 上传 SVG 失败，回落 base64:', err);
    }
  }

  const row = { id, mime, data: dataBase64, createdAt: new Date() };
  await db.insert(images).values(row);
  return { id, mime, data: dataBase64, key: null, url: null, thumbKey: null, thumbUrl: null, width: null, height: null, size: buffer.length };
}

/** 按 id 读取图片（供公开路由 /api/images/[id] 输出） */
export async function getImage(id: string): Promise<StoredImage | null> {
  const rows = await db.select().from(images).where(eq(images.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    mime: row.mime,
    data: row.data,
    key: row.key,
    url: row.url,
    thumbKey: row.thumbKey,
    thumbUrl: row.thumbUrl,
    width: row.width,
    height: row.height,
    size: row.size,
  };
}

/** 从 MDX 源码提取第一张图片 URL（无则 null） */
export function extractFirstImage(content: string): string | null {
  const match = content.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  return match?.[1] ?? null;
}

/**
 * 卡片/列表封面缩略图 URL：对 DB 图片（/api/images/<id>）追加 `?w=<width>&f=webp`，
 * 由路由按需缩放/重定向（R2 图重定向到已生成的缩略图）→ 不再加载原图，显著降 LCP 与字节。
 *
 * - 仅优化本站 `/api/images/` 路由的图片；外部 URL（R2 直链 / 图床）原样返回。
 * - 已带查询串时追加而非覆盖。
 * - 宽度按场景：卡片 600、Hero 1920。
 *
 * @param cover 原始封面 URL
 * @param width 目标宽度（像素），默认 600
 */
export function cardCoverUrl(cover: string | null | undefined, width = 600): string | null {
  if (!cover) return null;
  if (!cover.startsWith('/api/images/')) return cover;
  const sep = cover.includes('?') ? '&' : '?';
  return `${cover}${sep}w=${width}&f=webp`;
}
