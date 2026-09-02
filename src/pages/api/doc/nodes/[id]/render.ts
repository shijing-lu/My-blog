/**
 * GET /api/doc/nodes/[id]/render —— 渲染文章节点（服务端 MDX → HTML，公开）
 */
import type { APIRoute } from 'astro';
import { getDocNode } from '@/lib/docs';
import { renderMdx } from '@/lib/mdx';
import { json, jsonCached } from '@/lib/api';

export const prerender = false;

/**
 * 请求参数 `v`（= 节点 updatedAt）：**版本化缓存键**。
 *
 * 实测：大文章服务端首渲 180ms 固定开销 + 约 6.4ms/KB（243KB → 1.6s），
 * 而内存 LRU 命中仅 0.1ms —— 但 LRU 是单 Vercel 实例、冷启动即失效。
 * 带 `v` 时响应视为**不可变**，可安全长缓存到 CDN（s-maxage 1 年）：
 * 文章一改，updatedAt 变 → URL 变 → 旧缓存自然失效，无需显式清除。
 * 不带 `v` 时按原样返回（不缓存），供保存后强制取最新。
 */
export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);
  const v = url.searchParams.get('v');
  const node = await getDocNode(id);
  if (!node || node.kind !== 'article') return json({ error: '文章不存在' }, 404);
  try {
    const { html, toc } = await renderMdx(node.content);
    const payload = { title: node.title, html, toc };
    return v ? jsonCached(payload, 31_536_000, 86_400) : json(payload);
  } catch (err) {
    console.error('[api/doc/nodes/render]', err);
    return json({ error: '渲染失败' }, 500);
  }
};
