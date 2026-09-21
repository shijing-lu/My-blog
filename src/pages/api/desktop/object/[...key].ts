/**
 * 桌面端对象缓存路由（R2 对象的"按需下载"落点）
 *
 * 行为：
 *   1. 本地缓存命中 → 直接返回（离线也能看图）；
 *   2. 未命中 → 从 R2 下载一份、写入本地缓存、返回。
 *
 * 权限：本路由**不受** settings 权限保护（见 middleware 的显式放行）——
 * 它返回的是 R2 上**本就公开**的对象（与 publicUrl 的暴露面完全一致），
 * 桌面端未登录时也应能正常显示图片；其余 /api/desktop/* 仍受保护。
 */
import type { APIRoute } from 'astro';
import { getObject } from '@/lib/object-storage';
import { readLocalObject, writeLocalObject } from '@/sync/adapters/local-objects';

export const prerender = false;

/** 常见对象类型的 MIME（按扩展名推断；未知类型用 octet-stream） */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

function mimeOf(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

function respond(buffer: Buffer, key: string, cache: 'HIT' | 'MISS'): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': mimeOf(key),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-byqx-cache': cache,
    },
  });
}

export const GET: APIRoute = async ({ params }) => {
  const key = (params.key ?? '').replace(/^\/+/, '');
  if (!key) return new Response('missing key', { status: 400 });

  // 1) 本地缓存
  const cached = readLocalObject(key);
  if (cached) return respond(cached, key, 'HIT');

  // 2) 按需下载并落盘
  try {
    const buffer = await getObject(key);
    if (!buffer) return new Response('object not found', { status: 404 });
    writeLocalObject(key, buffer);
    return respond(buffer, key, 'MISS');
  } catch (err) {
    console.error('[api/desktop/object] 下载失败：', err);
    return new Response('fetch failed', { status: 502 });
  }
};
