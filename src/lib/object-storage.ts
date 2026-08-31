/**
 * R2 对象存储抽象（S3 兼容，供图片/字体/照片统一存取）
 *
 * - 字节存 Cloudflare R2（对象存储），DB 只存元数据 + 对象 key / 公开 URL。
 * - **惰性动态导入 @aws-sdk/client-s3**：SDK 体积大且传递依赖（@aws-sdk/checksums 等）
 *   在 serverless 打包时易缺失。仅在上传/删除等真正用到 S3 时 `import()`，避免
 *   让纯读路径（首页等，只需图片 URL）把 SDK 拖进模块图导致 500。
 * - 环境变量（见 .env.example）：
 *     R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL
 *     可选 R2_S3_ENDPOINT（默认按 ACCOUNT_ID 推导 https://<id>.r2.cloudflarestorage.com）
 *
 * 说明：
 * - 懒加载单例 S3Client；写入带 immutable 缓存头；删除/head 对 404 静默容忍。
 * - 公开 URL = `${base}/${key}`（已实测 r2.dev 桶名不在路径中）。
 */
import { serverEnv } from '@/lib/env';

/** R2 配置（读取环境变量） */
interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicBaseUrl: string;
}

/** 取 R2 配置；缺失必填项返回 null（未启用） */
function readConfig(): R2Config | null {
  const accountId = serverEnv('R2_ACCOUNT_ID');
  const accessKeyId = serverEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = serverEnv('R2_SECRET_ACCESS_KEY');
  const bucket = serverEnv('R2_BUCKET');
  const publicBaseUrl = serverEnv('R2_PUBLIC_BASE_URL');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = serverEnv('R2_S3_ENDPOINT') || `https://${accountId}.r2.cloudflarestorage.com`;
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint, publicBaseUrl };
}

/** 是否已配置 R2（决定自动上传可用性；未配置时走 URL 导入降级） */
export const r2Enabled = (): boolean => readConfig() !== null;

/** S3Client 单例（懒加载；仅首次真实 R2 操作时 import SDK） */
let clientPromise: Promise<unknown> | null = null;
async function getClient(): Promise<{ send: (cmd: unknown) => Promise<unknown> }> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const cfg = readConfig();
      if (!cfg) throw new Error('R2 未配置：请检查 R2_* 环境变量');
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: 'auto',
        endpoint: cfg.endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      });
    })();
  }
  return (await clientPromise) as { send: (cmd: unknown) => Promise<unknown> };
}

/** 上传对象（自动带 immutable 缓存头） */
export async function putObject(
  key: string,
  input: { buffer: Buffer; contentType: string },
): Promise<string> {
  const cfg = readConfig()!;
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: input.buffer,
      ContentType: input.contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return publicUrl(key);
}

/** 生成对象公开 URL（已实测：r2.dev 桶名不在路径中，base + '/' + key 即正确） */
export function publicUrl(key: string): string {
  const cfg = readConfig()!;
  const base = cfg.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/${key}`;
}

/** 判断对象是否存在（用于删除容忍 / 校验） */
export async function headObject(key: string): Promise<boolean> {
  try {
    const cfg = readConfig()!;
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getClient();
    await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** 删除对象（404 静默容忍） */
export async function deleteObject(key: string): Promise<void> {
  if (!r2Enabled()) return;
  try {
    const cfg = readConfig()!;
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getClient();
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch {
    /* 对象不存在或网络错误：忽略 */
  }
}
