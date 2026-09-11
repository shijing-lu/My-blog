/**
 * GET /api/nav —— 网址导航聚合数据（公开）
 *
 * → { categories: [{ id, name, icon, sort, sites: [{id,name,url,icon,desc}] }] }
 */
import type { APIRoute } from 'astro';
import { json, jsonCached } from '@/lib/api';
import { listNav } from '@/lib/nav';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    // P3-5：公开聚合数据、与登录态无关 → CDN 短缓存（判定规则见 jsonCached 注释）
    const categories = await listNav();
    return jsonCached({ categories });
  } catch (err) {
    console.error('[api/nav]', err);
    return json({ error: '获取导航数据失败' }, 500);
  }
};
