/**
 * GET/DELETE /api/fonts/[id] —— 字体输出（公开）/ 删除（管理员）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { deleteFont, getFontById } from '@/lib/fonts';

export const prerender = false;

/** GET：输出字体二进制（@font-face src 用） */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  const font = await getFontById(id);
  if (!font) return json({ error: '字体不存在' }, 404);
  const buffer = Buffer.from(font.data, 'base64');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': font.mime,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};

/** DELETE：删除（管理员） */
export const DELETE: APIRoute = async ({ params, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  const id = params.id ?? '';
  const font = await getFontById(id);
  if (!font) return json({ error: '字体不存在' }, 404);
  await deleteFont(id);
  return json({ ok: true });
};
