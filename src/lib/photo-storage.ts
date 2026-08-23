/**
 * 相册照片存储抽象（Vercel Blob）
 *
 * - 照片存 Vercel Blob（CDN + 公开 URL），不占用 DB；
 * - 未配置 `BLOB_READ_WRITE_TOKEN` 时 `photoStorageEnabled` 为 false，
 *   上传页自动隐藏「选择文件上传」，仅保留 URL 导入模式（本地可完整验收其余功能）；
 * - 博客现有 `images` 表（base64 存 DB）保持不变，两套存储并存。
 */
import { randomUUID } from 'node:crypto';
import { del, put } from '@vercel/blob';
import { hasServerEnv, serverEnv } from '@/lib/env';

/**
 * 取 Blob token 并同步到 process.env。
 * 本地开发时 .env 只进入 import.meta.env（Astro/Vite 加载），不会自动进
 * process.env；而 @vercel/blob SDK 内部只读 process.env.BLOB_READ_WRITE_TOKEN。
 * 这里统一从 serverEnv 取（import.meta.env 优先、process.env 兜底），
 * 显式传给 put/del，并回填 process.env 做双保险。
 */
function blobToken(): string {
  const token = serverEnv('BLOB_READ_WRITE_TOKEN');
  if (token && process.env.BLOB_READ_WRITE_TOKEN !== token) {
    process.env.BLOB_READ_WRITE_TOKEN = token;
  }
  return token;
}

/** 是否已配置 Vercel Blob（决定自动上传是否可用） */
export const photoStorageEnabled = hasServerEnv('BLOB_READ_WRITE_TOKEN');

/** MIME → 文件扩展名 */
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/**
 * 上传照片原图/缩略图到 Blob，返回公开 URL
 *
 * @param buffer 图片二进制
 * @param mime 图片 MIME
 * @returns 公开可访问的 URL
 */
export async function uploadPhotoObject(buffer: Buffer, mime: string): Promise<{ url: string }> {
  const ext = EXT[mime] ?? 'bin';
  const blob = await put(`gallery/${randomUUID()}.${ext}`, buffer, {
    access: 'public',
    contentType: mime,
    addRandomSuffix: true,
    token: blobToken(),
  });
  return { url: blob.url };
}

/**
 * 删除 Blob 对象（外部图床 URL / 对象已不存在时静默忽略）
 *
 * @param url 存储对象 URL
 */
export async function deletePhotoObject(url: string): Promise<void> {
  if (!url || !photoStorageEnabled) return;
  try {
    await del(url, { token: blobToken() });
  } catch {
    /* 外部 URL 或对象已删除：忽略 */
  }
}
