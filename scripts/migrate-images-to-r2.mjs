/**
 * 迁移脚本：把 DB 里 base64 图片、Vercel Blob 照片迁到 Cloudflare R2（plain node，无需 tsx）
 *
 * 用法（默认干跑）：
 *   node scripts/migrate-images-to-r2.mjs                       # 只打印将做什么
 *   node scripts/migrate-images-to-r2.mjs --apply               # 真正迁移并更新 DB
 *   node scripts/migrate-images-to-r2.mjs --sqlite ./data/blog.db
 *
 * 说明：
 * - 读取项目根 .env 的 R2_* 配置；用 sharp 生成两档 webp（全尺寸 1920 + 缩略 600）。
 * - images.data（base64）→ 上传 images/<id> + images/<id>_thumb → 更新 key/url/thumb/dims，清空 data。
 * - photos.url（Vercel Blob）→ 下载 → 上传 photos/<id>（+thumb）→ 更新 url/key/thumb；外部图床 URL 跳过。
 * - 幂等：已有 key 的行跳过。--apply 会更新 SQLite。
 *
 * 注意：这是本地 SQLite 的迁移；Supabase 生产库需在服务器上连 DATABASE_URL 另行迁移。
 */
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Database from 'better-sqlite3';

const APPLY = process.argv.includes('--apply');
const sqlitePath =
  (process.argv.find((a) => a.startsWith('--sqlite')) || '').split('=')[1] || './data/blog.db';

function env(key) {
  const raw = readFileSync('.env', 'utf8');
  const m = raw.split(/\r?\n/).find((l) => l.startsWith(key + '='));
  return m ? m.slice(key.length + 1).trim() : '';
}
const r2 = {
  accountId: env('R2_ACCOUNT_ID'),
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  bucket: env('R2_BUCKET'),
  publicBaseUrl: env('R2_PUBLIC_BASE_URL').replace(/\/+$/, ''),
  endpoint: env('R2_S3_ENDPOINT') || `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
};
if (!r2.accountId || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucket) {
  console.error('缺少 R2 配置（检查 .env 的 R2_*）');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: r2.endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
});

const publicUrl = (key) => `${r2.publicBaseUrl}/${key}`;
async function putObject(key, buffer, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return publicUrl(key);
}

/** 用 sharp 缩放为 webp，返回 { buffer, width, height } */
async function resizeToWebp(input, targetWidth, quality = 78) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(input).metadata();
  const origW = meta.width ?? 0;
  const origH = meta.height ?? 0;
  const outW = Math.min(targetWidth, Math.max(origW, 1));
  const outH = origW && origH ? Math.round((origH * outW) / origW) : 0;
  const buffer = await sharp(input)
    .resize({ width: outW, withoutEnlargement: true, fit: 'inside' })
    .webp({ quality })
    .toBuffer();
  return { buffer, width: outW, height: outH };
}
async function imageMeta(input) {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(input).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

const db = new Database(sqlitePath);
const FULL_WIDTH = 1920;
const THUMB_WIDTH = 600;

async function migrateImages() {
  const rows = db.prepare("SELECT id, mime, data FROM images WHERE data != ''").all();
  console.log(`[images] 待迁移 base64 行：${rows.length}`);
  for (const r of rows) {
    if (!APPLY) {
      console.log(`  - 将迁移 ${r.id.substring(0, 8)}… (${(Buffer.from(r.data, 'base64').length / 1024).toFixed(0)} KB)`);
      continue;
    }
    const buffer = Buffer.from(r.data, 'base64');
    try {
      const key = `images/${r.id}`;
      if (r.mime === 'image/svg+xml') {
        const url = await putObject(key, buffer, r.mime);
        const dims = await imageMeta(buffer);
        db.prepare('UPDATE images SET data=?, key=?, url=?, thumb_key=?, thumb_url=?, width=?, height=?, size=? WHERE id=?')
          .run('', key, url, null, null, dims.width, dims.height, buffer.length, r.id);
      } else {
        const full = await resizeToWebp(buffer, FULL_WIDTH);
        const thumb = await resizeToWebp(buffer, THUMB_WIDTH);
        const url = await putObject(key, full.buffer, 'image/webp');
        const thumbKey = `${key}_thumb`;
        const thumbUrl = await putObject(thumbKey, thumb.buffer, 'image/webp');
        db.prepare('UPDATE images SET data=?, key=?, url=?, thumb_key=?, thumb_url=?, width=?, height=?, size=? WHERE id=?')
          .run('', key, url, thumbKey, thumbUrl, full.width, full.height, full.buffer.length, r.id);
      }
      console.log(`  ✓ ${r.id.substring(0, 8)}… → ${publicUrl(key)}`);
    } catch (e) {
      console.error(`  ✗ ${r.id.substring(0, 8)}… 失败: ${e.message}`);
    }
  }
}

async function migratePhotos() {
  const rows = db
    .prepare('SELECT id, url, thumb_url, key FROM photos WHERE key IS NULL AND url LIKE \'%blob.vercel-storage.com%\'')
    .all();
  console.log(`[photos] 待迁移 Vercel Blob 行：${rows.length}`);
  for (const p of rows) {
    if (!APPLY) {
      console.log(`  - 将迁移 photos/${p.id.substring(0, 8)}…`);
      continue;
    }
    try {
      const orig = await fetch(p.url).then((r) => r.arrayBuffer());
      const key = `photos/${p.id}`;
      const ext = p.url.match(/\.(png|jpe?g|gif|webp|avif|svg)\b/i)?.[1]?.toLowerCase();
      const contentType = ext ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'image/webp';
      const url = await putObject(key, Buffer.from(orig), contentType);
      let thumbUrl = p.thumb_url;
      let thumbKey = null;
      if (p.thumb_url) {
        try {
          const t = await fetch(p.thumb_url).then((r) => r.arrayBuffer());
          thumbKey = `${key}_thumb`;
          thumbUrl = await putObject(thumbKey, Buffer.from(t), 'image/webp');
        } catch {}
      }
      db.prepare('UPDATE photos SET key=?, thumb_key=? WHERE id=?').run(key, thumbKey, p.id);
      console.log(`  ✓ photos/${p.id.substring(0, 8)}… → ${url}`);
    } catch (e) {
      console.error(`  ✗ photos/${p.id.substring(0, 8)}… 失败: ${e.message}`);
    }
  }
}

console.log(`模式：${APPLY ? 'APPLY（实际迁移）' : 'DRY-RUN（仅预览）'}  DB: ${sqlitePath}`);
try {
  await migrateImages();
  await migratePhotos();
  console.log('完成');
} catch (e) {
  console.error('迁移失败:', e.message);
  process.exit(1);
}
