/**
 * GET/DELETE /api/fonts/[id] —— 字体输出（公开）/ 删除（管理员）
 *
 * - Blob 直传字体：GET 302 重定向到 Blob 公开 URL；DELETE 先删 Blob 对象再删库
 * - base64 字体：GET 输出二进制；DELETE 直接删库
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { deleteBlobObject } from '@/lib/blob';
import { deleteFont, getFontById, isBlobFontData } from '@/lib/fonts';

export const prerender = false;

/** GET：输出字体二进制（@font-face src 用）；Blob 字体 302 到公开 URL */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  const font = await getFontById(id);
  if (!font) return json({ error: '字体不存在' }, 404);
  if (isBlobFontData(font.data)) {
    return new Response(null, {
      status: 302,
      headers: { location: font.data, 'cache-control': 'public, max-age=31536000, immutable' },
    });
  }
  const buffer = Buffer.from(font.data, 'base64');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': font.mime,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};

/** DELETE：删除（管理员）；Blob 字体同时删除存储对象 */
export const DELETE: APIRoute = async ({ params, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  const id = params.id ?? '';
  const font = await getFontById(id);
  if (!font) return json({ error: '字体不存在' }, 404);
  if (isBlobFontData(font.data)) {
    await deleteBlobObject(font.data);
  }
  await deleteFont(id);
  return json({ ok: true });
};
