/**
 * GET /api/images/[id] —— 输出图片（公开，CDN 可缓存）
 *
 * 查询参数（可选，用于缩略图/格式转换）：
 * - w=<像素>：最大宽度（如卡片封面 w=600）
 * - f=<webp|avif|jpeg|png>：输出格式，默认 webp
 *
 * 双模式：
 * - **base64 旧数据**（image.data 非空）：原样输出；带 w/f 时用 sharp 按需转换（P0）。
 * - **R2 存储**（image.data 为空且有 url/key）：直接 307 重定向到 R2 公开 URL；
 *   带 w 且有缩略图时重定向到已生成的缩略图（600px webp）。
 * - SVG 为矢量、GIF 为多帧动画（转码必丢帧），均原样输出不做转换。
 * - 图片 id 为 uuid，内容永不变 → 响应可 immutable 长缓存。
 */
import type { APIRoute } from 'astro';
import { getImage } from '@/lib/images';
import { isTransformableInput, normalizeWidth, transformImage } from '@/lib/image-transform';

export const prerender = false;

/** 输出图片二进制（base64 转换 / R2 重定向） */
export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id;
  if (!id) return new Response('Not Found', { status: 404 });
  const image = await getImage(id);
  if (!image) return new Response('Not Found', { status: 404 });

  const w = normalizeWidth(url.searchParams.get('w'));
  const f = url.searchParams.get('f');
  const cacheControl = 'public, max-age=31536000, immutable';

  // R2 存储且无 base64 数据 → 重定向到 R2 公开 URL
  // - 请求小宽度(<=600)且有缩略图 → 用缩略图（600px webp）
  // - 其余（无 w 或大宽度，如 Hero 1920）→ 用全图（1920px webp）
  if (!image.data && (image.url || image.thumbUrl)) {
    const target =
      w !== undefined && w <= 600 && image.thumbUrl ? image.thumbUrl : (image.url ?? image.thumbUrl);
    if (target) {
      return new Response(null, {
        status: 307,
        headers: { location: target, 'cache-control': cacheControl },
      });
    }
  }

  // 未请求转换、或矢量/不可转换类型，或无可转换的 base64 → 原样输出
  const wantsTransform = (w !== undefined || f !== null) && !!image.data && isTransformableInput(image.mime);
  if (!wantsTransform || !image.data) {
    const buffer = Buffer.from(image.data ?? '', 'base64');
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': image.mime, 'cache-control': cacheControl },
    });
  }

  try {
    const original = Buffer.from(image.data, 'base64');
    const { buffer, mime } = await transformImage(original, { width: w, format: f ?? undefined });
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
