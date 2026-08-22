/**
 * GET /api/images/[id] —— 输出图片（公开，CDN 可缓存）
 */
import type { APIRoute } from 'astro';
import { getImage } from '@/lib/images';

export const prerender = false;

/** 输出图片二进制 */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return new Response('Not Found', { status: 404 });
  const image = await getImage(id);
  if (!image) return new Response('Not Found', { status: 404 });
  const buffer = Buffer.from(image.data, 'base64');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': image.mime,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
