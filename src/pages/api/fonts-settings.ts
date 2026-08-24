/**
 * PUT /api/fonts-settings —— 保存全局字体设置（管理员）
 *
 * body: { article: {type,value}, ui: {type,value} }
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { saveSiteFonts } from '@/lib/fonts';
import type { SiteFonts } from '../../../db/types';

export const prerender = false;

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  let body: Partial<SiteFonts>;
  try {
    body = (await request.json()) as Partial<SiteFonts>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  try {
    const saved = await saveSiteFonts(body);
    return json({ fonts: saved });
  } catch (err) {
    console.error('[api/fonts-settings]', err);
    return json({ error: '保存失败' }, 500);
  }
};
