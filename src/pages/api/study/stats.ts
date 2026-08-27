/**
 * GET /api/study/stats —— 学习公开统计（无需登录）
 *
 * 返回今日/连续/累计/热力图/近 7 天聚合，不含任何私密数据。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { getStudyStats } from '@/lib/study-data';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const stats = await getStudyStats();
    return json({ stats });
  } catch (err) {
    console.error('[api/study/stats]', err);
    return json({ error: '统计失败' }, 500);
  }
};
