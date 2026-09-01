/**
 * GET/POST/PATCH /api/photos —— 相册照片列表 / 上传 / 批量标签
 *
 * - GET：分页列表 + 总数 + 时间线聚合（公开）；支持 ?tag= 过滤
 * - POST：上传单张照片（管理员，中间件保护）；JSON 携带原图+缩略图 base64
 *   与元数据；原图与缩略图经 Cloudflare R2 存储（未配置 R2 时 503）
 * - PATCH /api/photos/batch-tags：批量设置/添加/移除标签（管理员）
 */
import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import {
  MAX_TAGS,
  addPhoto,
  batchUpdateTags,
  countPhotos,
  getTimeline,
  listPhotos,
} from '@/lib/photos';
import { json, jsonCached } from '@/lib/api';
import { photoStorageEnabled, uploadPhotoObject } from '@/lib/photo-storage';
import { ALLOWED_MIME } from '@/lib/images';

export const prerender = false;

/** 默认/最大每页数量 */
const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * 单张原图解码后字节数上限：3MB
 * （base64 后约 4MB，加上缩略图 base64 与 JSON 开销，
 *   仍低于 Vercel Serverless 函数体 4.5MB 上限 FUNCTION_PAYLOAD_TOO_LARGE）
 */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** 标题长度上限 */
const MAX_TITLE_LENGTH = 200;

/** 解析标签（数组 → 字符串数组，上限 MAX_TAGS） */
function parseTagsArg(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.tags)) return [];
  return (body.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, MAX_TAGS);
}

/** GET：分页列表 + 总数 + 时间线（可选按标签过滤） */
export const GET: APIRoute = async ({ url }) => {
  const rawLimit = Number(url.searchParams.get('limit') ?? String(PAGE_SIZE));
  const rawOffset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.floor(rawLimit)), MAX_PAGE_SIZE)
    : PAGE_SIZE;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const tag = (url.searchParams.get('tag') ?? '').trim().slice(0, 20) || undefined;
  const filter = tag ? { tag } : {};

  const [items, total, timeline] = await Promise.all([
    listPhotos(limit, offset, filter),
    countPhotos(filter),
    getTimeline(),
  ]);

  return jsonCached({
    photos: items.map((p) => ({
      id: p.id,
      url: p.url,
      thumbUrl: p.thumbUrl,
      title: p.title,
      tags: p.tags,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt.toISOString(),
    })),
    total,
    timeline,
    tag: tag ?? null,
  });
};

/** POST：上传单张照片（管理员） */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  // 展示日期：合法 Date 即可（允许回填任意历史日期）
  const takenAt = new Date(typeof body.takenAt === 'string' ? body.takenAt : '');
  if (Number.isNaN(takenAt.getTime())) {
    return json({ error: '日期不合法' }, 400);
  }
  const title = typeof body.title === 'string' ? body.title.slice(0, MAX_TITLE_LENGTH) : '';
  const tags = parseTagsArg(body);
  const width = typeof body.width === 'number' && body.width > 0 ? Math.floor(body.width) : null;
  const height = typeof body.height === 'number' && body.height > 0 ? Math.floor(body.height) : null;

  // ---- URL 导入模式（PicGo / GitHub 图床工作流）：直接入库，不经过 Blob ----
  const importUrl = typeof body.importUrl === 'string' ? body.importUrl.trim() : '';
  if (importUrl) {
    if (!/^https?:\/\/\S+$/.test(importUrl) || importUrl.length > 2048) {
      return json({ error: 'URL 不合法' }, 400);
    }
    try {
      const photo = await addPhoto({
        id: randomUUID(),
        url: importUrl,
        thumbUrl: null,
        title,
        tags,
        width,
        height,
        takenAt,
      });
      return json({ photo: serializePhoto(photo) });
    } catch (err) {
      console.error('[api/photos/import]', err);
      return json({ error: '导入失败' }, 500);
    }
  }

  // ---- 自动上传模式（R2） ----
  if (!photoStorageEnabled) {
    return json({ error: '未配置 Cloudflare R2，自动上传不可用，请使用 URL 导入' }, 503);
  }

  const mime = typeof body.mime === 'string' ? body.mime : '';
  const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
  const thumbBase64 = typeof body.thumbBase64 === 'string' ? body.thumbBase64 : '';

  if (!ALLOWED_MIME.test(mime)) {
    return json({ error: '仅支持 PNG / JPG / GIF / WebP / AVIF / SVG 图片' }, 400);
  }
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length === 0) return json({ error: '缺少图片数据' }, 400);
  if (buffer.length > MAX_PHOTO_BYTES) {
    return json({ error: '图片不能超过 3MB（压缩后上传）' }, 400);
  }
  // 请求体体积兜底：base64 原图 + 缩略图不应超过 4.2MB（Vercel 4.5MB 上限留余量）
  if (dataBase64.length + thumbBase64.length > 4.2 * 1024 * 1024) {
    return json({ error: '请求体过大' }, 413);
  }

  try {
    const id = randomUUID();
    const key = `photos/${id}`;
    const { url } = await uploadPhotoObject(buffer, mime, key);
    let thumbUrl: string | null = null;
    let thumbKey: string | null = null;
    if (thumbBase64.length > 0) {
      const thumb = Buffer.from(thumbBase64, 'base64');
      if (thumb.length > 0) {
        thumbKey = `photos/${id}_thumb`;
        const t = await uploadPhotoObject(thumb, mime, thumbKey);
        thumbUrl = t.url;
      }
    }
    const photo = await addPhoto({
      id,
      url,
      key,
      thumbUrl,
      thumbKey,
      title,
      tags,
      width,
      height,
      takenAt,
    });
    return json({ photo: serializePhoto(photo) });
  } catch (err) {
    console.error('[api/photos]', err);
    return json({ error: '上传失败' }, 500);
  }
};

/** 照片实体 → 可序列化对象 */
function serializePhoto(p: {
  id: string;
  url: string;
  thumbUrl: string | null;
  title: string;
  tags: string[];
  width: number | null;
  height: number | null;
  takenAt: Date;
}): {
  id: string;
  url: string;
  thumbUrl: string | null;
  title: string;
  tags: string[];
  width: number | null;
  height: number | null;
  takenAt: string;
} {
  return {
    id: p.id,
    url: p.url,
    thumbUrl: p.thumbUrl,
    title: p.title,
    tags: p.tags,
    width: p.width,
    height: p.height,
    takenAt: p.takenAt.toISOString(),
  };
}
