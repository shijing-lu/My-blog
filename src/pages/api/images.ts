/**
 * POST /api/images —— 上传图片（管理员）
 *
 * 请求体：{ filename?, mime, data }，data 为 base64 编码的图片二进制。
 * 返回：{ ok, url: '/api/images/<id>' }（markdown 引用为 ![](url)）。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { storeImage, validateImageUpload } from '@/lib/images';

export const prerender = false;

/** 上传处理 */
export const POST: APIRoute = async ({ request }) => {
  let body: { filename?: unknown; mime?: unknown; data?: unknown };
  try {
    body = (await request.json()) as { filename?: unknown; mime?: unknown; data?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const base64 = typeof body.data === 'string' ? body.data : '';
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return json({ error: '图片数据无法解码' }, 400);
  }

  const error = validateImageUpload(body.mime, base64, buffer.length);
  if (error) return json({ error }, 400);

  const stored = await storeImage(body.mime as string, base64);
  return json({ ok: true, url: `/api/images/${stored.id}` });
};
