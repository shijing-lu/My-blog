/**
 * PUT/DELETE /api/fonts-settings —— 全局字体设置（管理员）
 *
 * PUT:    { article: {type,value}, ui: {type,value} } → 保存手动字体（全站优先于主题）
 * DELETE: → 清除手动字体设置，恢复跟随当前主题字体
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { verifyRequest } from '@/lib/auth';
import { clearSiteFonts, saveSiteFonts } from '@/lib/fonts';
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

/** DELETE：清除手动字体设置（恢复跟随主题字体） */
export const DELETE: APIRoute = async ({ cookies }) => {
  if (!verifyRequest(cookies)) return json({ error: 'unauthorized' }, 401);
  try {
    await clearSiteFonts();
    return json({ ok: true });
  } catch (err) {
    console.error('[api/fonts-settings]', err);
    return json({ error: '清除失败' }, 500);
  }
};
