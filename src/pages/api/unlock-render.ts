/**
 * POST /api/unlock-render —— 加密文章解锁后的正文渲染
 *
 * ## 为什么需要这个接口
 *
 * 加密文章采用「服务端加密 + 客户端解密 + 服务端渲染」架构：
 * 1. 密文存库，解密密钥由用户密码在**浏览器内**派生（服务端从未见过密码）；
 * 2. 浏览器用 Web Crypto 解出明文 MDX；
 * 3. 明文 MDX POST 到本接口，复用现成的 `renderMdx` 全链路渲染成 HTML
 *    （公式 / 荧光高亮 / Callout / 图片尺寸注入 / 目录 …）。
 *
 * 这样既保证「没有密码就拿不到正文」，又不必在前端重建一套 Markdown 渲染器，
 * 视觉效果与普通文章完全一致。
 *
 * ## 安全说明
 *
 * - 本接口**不做鉴权**：加密文章的公开发布形态本就是「知道密码即可阅读」，
 *   与站主身份无关；调用方必须已持有正确密码才能解出明文（拿到明文本身即凭据）。
 * - 不返回目录锚点映射等内部数据之外的内容；渲染失败按 400 返回明确原因。
 * - 请求体大小受限（1MB），避免被用作大文本渲染资源放大器。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { renderMdx } from '@/lib/mdx';
import { getImageSizes, collectImageIdsFromHtml, injectImageSizeAttrs } from '@/lib/images';

export const prerender = false;

/** 明文 MDX 体积上限（字符数）。正常文章远小于此值 */
const MAX_SOURCE_CHARS = 1_000_000;
/** 单 IP 简单节流窗口（毫秒）与最小间隔，避免被当作渲染放大器 */
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX = 30;

/** 简易内存节流表（单实例；Vercel Function 冷启动即清空，仅作粗粒度保护） */
const hits = new Map<string, number[]>();

/** 判断某请求是否超过节流阈值 */
function throttled(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < THROTTLE_WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  // 表过大时清理最旧的一半，防止内存无界增长
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t > THROTTLE_WINDOW_MS)) hits.delete(k);
      if (hits.size <= 2500) break;
    }
  }
  return arr.length > THROTTLE_MAX;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (throttled(clientAddress ?? 'unknown')) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const source = typeof body.source === 'string' ? body.source : '';
  const photoLayout = body.photo === true;
  if (!source.trim()) return json({ error: '正文为空' }, 400);
  if (source.length > MAX_SOURCE_CHARS) {
    return json({ error: '正文过长' }, 413);
  }

  try {
    const { html: rawHtml, toc, blockMap } = await renderMdx(source);

    // 与 blog/[slug].astro 保持一致：正文图片注入原始宽高，防止懒加载跳变。
    // photo 类型由 PhotoLayout 的 16/9 主导排版，不注入。
    let html = rawHtml;
    if (!photoLayout) {
      const ids = collectImageIdsFromHtml(rawHtml);
      if (ids.length > 0) {
        const sizes = await getImageSizes(ids);
        if (sizes.size > 0) html = injectImageSizeAttrs(rawHtml, sizes);
      }
    }

    return json({ ok: true, html, toc, blockMap });
  } catch (err) {
    console.error('[api/unlock-render]', err);
    return json({ error: '正文渲染失败' }, 400);
  }
};
