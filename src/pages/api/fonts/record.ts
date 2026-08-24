/**
 * POST /api/fonts/record —— 记录 Blob 直传完成的字体（管理员）
 *
 * body: { familyName, url, mime, size }
 * → 201 { font: { id, familyName, mime, size } }
 *
 * url 必须是本站 Blob 存储（*.public.blob.vercel-storage.com/fonts/）的公开 URL，
 * 防止把任意外部链接/伪造链接写库。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { addFontBlob } from '@/lib/fonts';
import { MAX_BLOB_BYTES } from './upload-url';

export const prerender = false;

const MAX_NAME = 100;
/** 本站 Blob 公开 URL（Vercel Blob store 域名，字体路径前缀 fonts/） */
const BLOB_URL_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/fonts\//i;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);

  let body: { familyName?: unknown; mime?: unknown; url?: unknown; size?: unknown };
  try {
    body = (await request.json()) as { familyName?: unknown; mime?: unknown; url?: unknown; size?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const familyName = typeof body.familyName === 'string' ? body.familyName.trim().slice(0, MAX_NAME) : '';
  if (!familyName) return json({ error: '请填写字体名称' }, 400);

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !BLOB_URL_RE.test(url)) return json({ error: '字体 URL 不合法（仅接受本站 Blob 直传结果）' }, 400);

  const mime = typeof body.mime === 'string' && /^font\/[\w.+-]+$/.test(body.mime) ? body.mime : 'font/woff2';
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BLOB_BYTES) {
    return json({ error: '文件大小不合法' }, 400);
  }

  try {
    const font = await addFontBlob({ familyName, mime, url, size });
    return json({ font: { id: font.id, familyName: font.familyName, mime: font.mime, size: font.size } }, 201);
  } catch (err) {
    console.error('[api/fonts/record]', err);
    return json({ error: '记录失败' }, 500);
  }
};
