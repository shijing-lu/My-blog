/**
 * POST /api/fonts/upload-url —— 为大字体签发 Blob 客户端上传 token（管理员）
 *
 * 大字体（>3MB，Vercel 函数请求体 4.5MB 硬上限）走浏览器直传：
 * 客户端拿本接口签发的受限 token 直接 PUT 到 Blob 存储，文件不经过函数体。
 *
 * body: { mime, filename? }
 * → { pathname, token, contentType, maxBytes }
 */
import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { blobStorageEnabled, blobToken } from '@/lib/blob';

export const prerender = false;

/** Blob 直传上限：30MB（20MB 全量中文字体绰绰有余） */
export const MAX_BLOB_BYTES = 30 * 1024 * 1024;

/** 字体 MIME → 扩展名 */
const MIME_EXT: Record<string, string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'application/x-font-ttf': 'ttf',
  'application/x-font-truetype': 'ttf',
  'font/otf': 'otf',
  'application/x-font-opentype': 'otf',
  'application/vnd.ms-opentype': 'otf',
};

/** 允许的内容类型（font/* 通配 + 浏览器常见的 octet-stream 兜底） */
const ALLOWED_CONTENT_TYPES = [
  'font/*',
  'application/octet-stream',
  'application/x-font-ttf',
  'application/x-font-truetype',
  'application/x-font-opentype',
  'application/vnd.ms-opentype',
];

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  if (!blobStorageEnabled) {
    return json({ error: '未配置 BLOB_READ_WRITE_TOKEN，大字体直传不可用（请改用 ≤3MB 字体或先在 Vercel 配置 Blob）' }, 503);
  }

  let body: { mime?: unknown; filename?: unknown };
  try {
    body = (await request.json()) as { mime?: unknown; filename?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const mime = typeof body.mime === 'string' && /^font\/[\w.+-]+$/.test(body.mime) ? body.mime : '';
  const filenameExt =
    typeof body.filename === 'string' ? (body.filename.split('.').pop() ?? '').toLowerCase() : '';
  const ext = MIME_EXT[mime] ?? (['woff2', 'woff', 'ttf', 'otf'].includes(filenameExt) ? filenameExt : '');
  if (!ext) return json({ error: '无法识别字体格式（支持 woff2/woff/ttf/otf）' }, 400);
  const contentType = mime || `font/${ext}`;

  const pathname = `fonts/${randomUUID()}.${ext}`;
  try {
    // 受限 token：只能上传到该 pathname，限类型、限大小、10 分钟内有效
    const token = await generateClientTokenFromReadWriteToken({
      token: blobToken(),
      pathname,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      maximumSizeInBytes: MAX_BLOB_BYTES,
      validUntil: Date.now() + 10 * 60 * 1000,
      addRandomSuffix: false,
    });
    return json({ pathname, token, contentType, maxBytes: MAX_BLOB_BYTES });
  } catch (err) {
    console.error('[api/fonts/upload-url]', err);
    return json({ error: '签发上传凭证失败' }, 500);
  }
};
