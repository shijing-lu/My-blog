/**
 * 相册照片存储抽象（Cloudflare R2，替代 Vercel Blob）
 *
 * - 照片字节存 R2（对象存储），DB 只存元数据 + key/URL；
 * - 未配置 R2 时 `photoStorageEnabled` 为 false，上传页自动隐藏「选择文件上传」，
 *   仅保留 URL 导入模式（本地可完整验收其余功能）；
 * - 博客 `images`（文章内嵌图）与 `photos`（影集）都走 R2，统一 object-storage。
 */
import { randomUUID } from 'node:crypto';
import { r2Enabled, putObject } from '@/lib/object-storage';

/** 是否已配置 R2（决定自动上传是否可用；模块加载时求值一次，布尔） */
export const photoStorageEnabled = r2Enabled();
/** 删除 R2 对象（兼容旧导入名） */
export { deleteObject as deletePhotoObject } from '@/lib/object-storage';

/** MIME → 文件扩展名（对象 key 后缀，便于直观，非必需） */
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/**
 * 上传照片原图/缩略图到 R2，返回公开 URL
 *
 * @param buffer 图片二进制
 * @param mime 图片 MIME
 * @param key 对象 key（由调用方生成，如 photos/<uuid>）；缺省随机生成
 * @returns 公开可访问的 URL
 */
export async function uploadPhotoObject(
  buffer: Buffer,
  mime: string,
  key?: string,
): Promise<{ url: string }> {
  const ext = EXT[mime] ?? 'bin';
  const objectKey = key ?? `photos/${randomUUID()}.${ext}`;
  const url = await putObject(objectKey, { buffer, contentType: mime });
  return { url };
}
