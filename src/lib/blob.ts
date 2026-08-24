/**
 * Vercel Blob 公共封装（照片 / 大字体共用）
 *
 * - token 从 serverEnv 取（import.meta.env 优先、process.env 兜底）并同步回
 *   process.env（@vercel/blob SDK 内部只读 process.env.BLOB_READ_WRITE_TOKEN）；
 * - 未配置 token 时 blobStorageEnabled 为 false（自动上传不可用，走降级路径）。
 */
import { del } from '@vercel/blob';
import { hasServerEnv, serverEnv } from '@/lib/env';

/** 取 Blob token 并同步到 process.env（本地 .env 由 Astro 载入 import.meta.env） */
export function blobToken(): string {
  const token = serverEnv('BLOB_READ_WRITE_TOKEN');
  if (token && process.env.BLOB_READ_WRITE_TOKEN !== token) {
    process.env.BLOB_READ_WRITE_TOKEN = token;
  }
  return token;
}

/** 是否已配置 Vercel Blob（决定大文件自动上传是否可用） */
export const blobStorageEnabled = hasServerEnv('BLOB_READ_WRITE_TOKEN');

/**
 * 删除 Blob 对象（外部 URL / 对象已不存在 / 未配置时静默忽略）
 *
 * @param url 存储对象公开 URL
 */
export async function deleteBlobObject(url: string): Promise<void> {
  if (!url || !blobStorageEnabled) return;
  try {
    await del(url, { token: blobToken() });
  } catch {
    /* 外部 URL 或对象已删除：忽略 */
  }
}
