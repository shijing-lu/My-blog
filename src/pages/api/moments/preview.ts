/**
 * POST /api/moments/preview —— 动态内容 Markdown → HTML 预览（管理员）
 *
 * body: { source }
 * 返回 { html }：与列表/回显同一套 `renderMarkdownHtml`（纯 GFM 管线），
 * 保证编辑/发布预览所见即最终卡片所渲染（单一服务端渲染来源，XSS 安全）。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { renderMarkdownHtml } from '@/lib/mdx';

export const prerender = false;

const MAX_SOURCE = 2000;

export const POST: APIRoute = async ({ request }) => {
  let body: { source?: unknown };
  try {
    body = (await request.json()) as { source?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const source = typeof body.source === 'string' ? body.source.slice(0, MAX_SOURCE) : '';
  try {
    const html = await renderMarkdownHtml(source);
    return json({ html });
  } catch (err) {
    console.error('[api/moments/preview]', err);
    return json({ error: '渲染失败，请检查语法' }, 422);
  }
};
