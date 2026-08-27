/**
 * GET /api/nav —— 网址导航聚合数据（公开）
 *
 * → { categories: [{ id, name, icon, sort, sites: [{id,name,url,icon,desc}] }] }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { listNav } from '@/lib/nav';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const categories = await listNav();
    return json({ categories });
  } catch (err) {
    console.error('[api/nav]', err);
    return json({ error: '获取导航数据失败' }, 500);
  }
};
