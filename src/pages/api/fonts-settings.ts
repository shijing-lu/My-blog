/**
 * PUT/DELETE /api/fonts-settings —— 全局字体设置（管理员）
 *
 * PUT:    { article: {type,value}, ui: {type,value} } → 保存手动字体（全站优先于主题）
 * DELETE: → 清除手动字体设置，恢复跟随当前主题字体
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { clearSiteFonts, saveSiteFonts } from '@/lib/fonts';
import type { SiteFonts } from '../../../db/types';

export const prerender = false;

export const PUT: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<Partial<SiteFonts>>(request);
  if (!body) return badJson();
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
  const denied = await guardManager(cookies);
  if (denied) return denied;
  try {
    await clearSiteFonts();
    return json({ ok: true });
  } catch (err) {
    console.error('[api/fonts-settings]', err);
    return json({ error: '清除失败' }, 500);
  }
};
