/**
 * R2 对象存储抽象（S3 兼容，供图片/字体/照片统一存取）
 *
 * 替换旧的 Vercel Blob / base64 存库方案：
 * - 字节存 Cloudflare R2（对象存储），免费 10GB、0 出网费、请求量级百万/月；
 * - 数据库只存元数据 + 对象 key / 公开 URL（见 images/photos 表），热路径不读库。
 *
 * 环境变量（见 .env.example）：
 *   R2_ACCOUNT_ID           账号 ID（32 位十六进制，如 f19de861...）
 *   R2_ACCESS_KEY_ID        R2 API Token 的 Access Key ID
 *   R2_SECRET_ACCESS_KEY    R2 API Token 的 Secret Access Key
 *   R2_BUCKET               R2 桶名
 *   R2_PUBLIC_BASE_URL      公开访问地址（r2.dev 或自定义域名）
 *   R2_S3_ENDPOINT          可选，默认按 ACCOUNT_ID 推导 https://<id>.r2.cloudflarestorage.com
 *
 * 说明：
 * - 懒加载单例 S3Client（serverless 实例间复用）；
 * - 写入对象时带 `Cache-Control: public, max-age=31536000, immutable`（图片 id 为 uuid，内容永不变）；
 * - 删除/head 对 404 静默容忍（复用既有"外部 URL"容忍逻辑）；
 * - `publicUrl` 拼接公开地址：默认 `${base}/${key}`。若你的 `pub-<hash>.r2.dev` 桶名必须出现在
 *   路径中，改 `urlFor` 一处即可（见注释）。
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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

/** S3Client 单例（懒加载） */
let client: S3Client | null = null;
function getClient(): S3Client {
  if (client) return client;
  const cfg = readConfig();
  if (!cfg) throw new Error('R2 未配置：请检查 R2_* 环境变量');
  // region 取 'auto'；forcePathStyle 兼容自定义端点（以路径形式携带桶名）
  client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return client;
}

/** 上传对象（自动带 immutable 缓存头） */
export async function putObject(
  key: string,
  input: { buffer: Buffer; contentType: string },
): Promise<string> {
  const cfg = readConfig()!;
  await getClient().send(
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
    await getClient().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
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
    await getClient().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch {
    /* 对象不存在或网络错误：忽略 */
  }
}
