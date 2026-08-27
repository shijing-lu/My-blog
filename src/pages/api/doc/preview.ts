/**
 * POST /api/doc/preview —— Markdown/MDX → HTML 预览（登录）
 *
 * body: { source }
 * 返回 { html, toc }，供编辑器弹窗"预览"使用。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { renderMdx } from '@/lib/mdx';

export const prerender = false;

const MAX_SOURCE = 200_000;

export const POST: APIRoute = async ({ request }) => {
  let body: { source?: unknown };
  try {
    body = (await request.json()) as { source?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const source = typeof body.source === 'string' ? body.source.slice(0, MAX_SOURCE) : '';
  if (!source) return json({ error: '内容为空' }, 400);
  try {
    const { html, toc } = await renderMdx(source);
    return json({ html, toc });
  } catch (err) {
    console.error('[api/doc/preview]', err);
    return json({ error: '渲染失败，请检查语法' }, 422);
  }
};
