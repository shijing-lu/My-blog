/**
 * POST /api/moments/preview —— 动态内容 Markdown → HTML 预览（管理员）
 *
 * body: { source }
 * 返回 { html }：调用 `renderMomentContent`——与列表/加载更多/发布后卡片展示
 * **完全同一实现**（renderMdx 完整管线 + 图片宽高注入），保证「预览所见即最终展示」。
 * 单一服务端渲染来源，XSS 安全同源（remark-rehype 不放行原始 HTML）。
 */
import type { APIRoute } from 'astro';
import { badJson, json, readJson } from '@/lib/api';
import { renderMomentContent } from '@/lib/moments';

export const prerender = false;

const MAX_SOURCE = 2000;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<{ source?: unknown }>(request);
  if (!body) return badJson();
  const source = typeof body.source === 'string' ? body.source.slice(0, MAX_SOURCE) : '';
  try {
    const html = await renderMomentContent(source);
    return json({ html });
  } catch (err) {
    console.error('[api/moments/preview]', err);
    return json({ error: '渲染失败，请检查语法' }, 422);
  }
};
