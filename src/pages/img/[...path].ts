/**
 * GET /img/<yyyy>/<mm>/<hash>.<ext> —— GitHub 图床反代（公开，CDN/边缘可长缓存）
 *
 * 浏览器只连本站域名；本路由服务端回源 raw.githubusercontent.com 取图并流式透传。
 * 国内 raw 域名被 DNS 污染不可直连，Vercel 服务端（海外）回源稳定 —— 这是图床链路的主通道。
 *
 * - 路径严格校验 `^<yyyy>/<mm>/<hash10>.<ext>$`（hash 命名，天然防目录穿越）；
 * - hash 命名内容永不变 → `immutable` 长缓存 + `s-maxage` 供边缘缓存，
 *   第二次请求直接命中 Vercel 边缘，不再回源 GitHub；
 * - public 仓库 raw 直链无需 token（token 仅用于上传）。
 */
import type { APIRoute } from 'astro';
import { getImageBedConfig } from '@/lib/image-bed';
import { EXT_MIME } from '@/lib/gh-image-bed';

export const prerender = false;

/** 站内路径校验：2026/09/ab12cd34ef.png（params.path 不含 /img 前缀） */
const PATH_RE = /^\d{4}\/\d{2}\/[a-f0-9]{10}\.(png|jpg|gif|webp|avif|svg)$/;

/** 回源超时（毫秒） */
const UPSTREAM_TIMEOUT_MS = 30_000;

export const GET: APIRoute = async ({ params }) => {
  const path = (params.path ?? '').replace(/^\/+/, '');
  if (!PATH_RE.test(path)) return new Response('Not Found', { status: 404 });

  const config = await getImageBedConfig();
  if (!config.owner || !config.repo) {
    return new Response('Image bed not configured', { status: 404 });
  }

  // branch 可能含斜杠（如 release/v1），encodeURI 保留斜杠仅转义特殊字符
  const branch = encodeURI(config.branch || 'main');
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${branch}/img/${path}`;
  const ext = path.split('.').pop() ?? '';

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(rawUrl, { signal: ac.signal, redirect: 'follow' });
    if (!upstream.ok || !upstream.body) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': EXT_MIME[ext] ?? upstream.headers.get('content-type') ?? 'application/octet-stream',
        // immutable：hash 命名内容永不变；s-maxage：Vercel 边缘缓存，命中后不再回源
        'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/img] upstream error:', msg);
    return new Response(msg.toLowerCase().includes('abort') ? 'Upstream timeout' : 'Upstream error', {
      status: 502,
    });
  } finally {
    clearTimeout(timer);
  }
};
