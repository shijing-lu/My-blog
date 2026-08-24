/**
 * 相册照片存储抽象（Vercel Blob）
 *
 * - 照片存 Vercel Blob（CDN + 公开 URL），不占用 DB；
 * - 未配置 `BLOB_READ_WRITE_TOKEN` 时 `photoStorageEnabled` 为 false，
 *   上传页自动隐藏「选择文件上传」，仅保留 URL 导入模式（本地可完整验收其余功能）；
 * - 博客现有 `images` 表（base64 存 DB）保持不变，两套存储并存。
 */
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { blobToken } from '@/lib/blob';

/** 是否已配置 Vercel Blob（决定自动上传是否可用） */
export { blobStorageEnabled as photoStorageEnabled } from '@/lib/blob';
/** 删除照片 Blob 对象（兼容旧导入名） */
export { deleteBlobObject as deletePhotoObject } from '@/lib/blob';

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
