/**
 * GET /api/export/image?url=... —— 导出 PDF 时的**同源图片代理**
 *
 * 浏览器端把正文画进 `<canvas>` 再导出时，跨域图片会污染画布
 * （`toDataURL` 抛 SecurityError，整次导出失败）。R2 公开域名默认不带
 * CORS 头，因此导出前把跨域 `<img>` 改写成走本端点的同源地址。
 *
 * 安全约束（避免变成开放代理 / SSRF 跳板）：
 * - 只允许 http(s)；
 * - 目标 origin 必须在白名单内：本站 origin / `PUBLIC_SITE_URL` /
 *   `R2_PUBLIC_BASE_URL`（R2 对象本就公开，暴露面与原 publicUrl 一致）；
 * - 跟随重定向后再校验一次最终 origin；
 * - 只回传 `image/*` 且限制体积，其余一律拒绝。
 */
import type { APIRoute } from 'astro';
import { serverEnv } from '@/lib/env';

export const prerender = false;

/** 单图体积上限（导出 PDF 用的插图足够大，同时挡住滥用） */
const MAX_BYTES = 12 * 1024 * 1024;

/** 允许的来源白名单（本站 + 已配置的公开站点 / 对象存储域名） */
function allowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>([new URL(request.url).origin]);
  for (const key of ['PUBLIC_SITE_URL', 'R2_PUBLIC_BASE_URL']) {
    const value = serverEnv(key);
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      /* 配置非法时忽略该来源 */
    }
  }
  return origins;
}

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'cache-control': 'no-store' } });
}

export const GET: APIRoute = async ({ url, request }) => {
  const raw = url.searchParams.get('url') ?? '';
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return text('无效的图片地址', 400);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return text('不支持的协议', 400);

  const allowed = allowedOrigins(request);
  if (!allowed.has(target.origin)) return text('不允许的图片来源', 403);

  try {
    const response = await fetch(target.href, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return text('图片获取失败', 502);
    // 重定向后可能落到白名单之外，必须复核最终地址
    if (!allowed.has(new URL(response.url).origin)) return text('不允许的图片来源', 403);
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return text('非图片资源', 415);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return text('图片过大', 413);
    return new Response(buffer, {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' },
    });
  } catch {
    return text('图片获取失败', 502);
  }
};
