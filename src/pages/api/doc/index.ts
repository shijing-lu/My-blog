/**
 * GET /api/doc —— 文档树（公开）
 *
 * 返回分类 → 文档 → 文章元信息的聚合视图（不含文章正文）。
 */
import type { APIRoute } from 'astro';
import { json, jsonCached } from '@/lib/api';
import { listDocTree } from '@/lib/docs';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const categories = await listDocTree();
    return jsonCached({ categories });
  } catch (err) {
    console.error('[api/doc]', err);
    return json({ error: '读取失败' }, 500);
  }
};
