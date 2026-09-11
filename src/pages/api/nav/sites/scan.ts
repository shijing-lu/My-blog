/**
 * POST /api/nav/sites/scan —— 抓取网站简介（管理员）
 *
 * body: { url }
 * → { desc? } 200（抓到简介；未抓到 desc 省略）
 * → { error } 400/500
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, readJson } from '@/lib/api';
import { fetchSiteMeta } from '@/lib/nav-metadata';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<{ url?: unknown }>(request);
  if (!body) return badJson();
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return badRequest('请填写网址');
  const meta = await fetchSiteMeta(url);
  if (!meta) return json({ error: '未能抓取到简介（站点可能屏蔽抓取或不存在）' }, 422);
  return json({ desc: meta.desc });
};
