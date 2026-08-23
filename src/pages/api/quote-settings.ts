/**
 * GET/PUT /api/quote-settings —— 首页 Hero 诗词轮播配置
 *
 * - GET：读取配置（公开，供前端播放与管理弹窗回显）
 * - PUT：保存配置（管理员，中间件保护）
 */
import type { APIRoute } from 'astro';
import { getHeroQuoteSettings, saveHeroQuoteSettings, type HeroQuoteSettings } from '@/lib/quote-settings';
import { json } from '@/lib/api';

export const prerender = false;

/** GET：读取配置 */
export const GET: APIRoute = async () => {
  const settings = await getHeroQuoteSettings();
  return json(settings);
};

/** PUT：保存配置（管理员） */
export const PUT: APIRoute = async ({ request }) => {
  let body: Partial<HeroQuoteSettings>;
  try {
    body = (await request.json()) as Partial<HeroQuoteSettings>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: '请求体不合法' }, 400);
  }
  try {
    const saved = await saveHeroQuoteSettings(body);
    return json(saved);
  } catch (err) {
    console.error('[api/quote-settings]', err);
    return json({ error: '保存失败' }, 500);
  }
};
