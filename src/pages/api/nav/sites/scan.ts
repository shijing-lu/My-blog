/**
 * POST /api/nav/sites/scan —— 抓取网站简介（管理员）
 *
 * body: { url }
 * → { desc? } 200（抓到简介；未抓到 desc 省略）
 * → { error } 400/500
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { fetchSiteMeta } from '@/lib/nav-metadata';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return json({ error: '请填写网址' }, 400);
  const meta = await fetchSiteMeta(url);
  if (!meta) return json({ error: '未能抓取到简介（站点可能屏蔽抓取或不存在）' }, 422);
  return json({ desc: meta.desc });
};
