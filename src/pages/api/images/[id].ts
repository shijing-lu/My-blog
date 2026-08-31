/**
 * GET /api/images/[id] —— 输出图片（公开，CDN 可缓存）
 *
 * 查询参数（可选，用于缩略图/格式转换，显著降 LCP 与页面字节）：
 * - w=<像素>：最大宽度，等比缩放，不放大（如卡片封面 w=600）
 * - f=<webp|avif|jpeg|png>：输出格式，默认 webp
 *
 * - 无参数 → 原图原样输出（向后兼容，含存量文章内容 ![](/api/images/xxx) 引用）。
 * - SVG 为矢量，原样输出不走转换。
 * - 转换失败 → 回落原图（不返回 500）。
 * - 图片 id 为 uuid，内容永不变 → 响应可 immutable 长缓存，首次转换后 CDN/边缘命中。
 */
import type { APIRoute } from 'astro';
import { getImage } from '@/lib/images';
import { isTransformableInput, normalizeWidth, transformImage } from '@/lib/image-transform';

export const prerender = false;

/** 输出图片二进制（按查询参数按需转换） */
export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id;
  if (!id) return new Response('Not Found', { status: 404 });
  const image = await getImage(id);
  if (!image) return new Response('Not Found', { status: 404 });

  const w = normalizeWidth(url.searchParams.get('w'));
  const f = url.searchParams.get('f');
  const cacheControl = 'public, max-age=31536000, immutable';

  // 未请求转换、或矢量/不可转换类型 → 原样输出
  const wantsTransform = (w !== undefined || f !== null) && isTransformableInput(image.mime);
  if (!wantsTransform) {
    const buffer = Buffer.from(image.data, 'base64');
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': image.mime, 'cache-control': cacheControl },
    });
  }

  try {
    const original = Buffer.from(image.data, 'base64');
    const { buffer, mime } = await transformImage(original, {
      width: w,
      format: f ?? undefined,
    });
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': mime, 'cache-control': cacheControl },
    });
  } catch {
    // 转换失败（损坏/不支持）→ 回落原图，不阻断展示
    const buffer = Buffer.from(image.data, 'base64');
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': image.mime, 'cache-control': cacheControl },
    });
  }
};
