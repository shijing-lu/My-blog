/**
 * GET/PUT /api/background —— 全站背景配置
 *
 * - GET：读取配置（公开，供页面渲染与设置页回显）
 * - PUT：保存配置（管理员，中间件保护）
 */
import type { APIRoute } from 'astro';
import { getSiteBackground, saveSiteBackground } from '@/lib/background';
import { json } from '@/lib/api';

export const prerender = false;

/** GET：读取 */
export const GET: APIRoute = async () => {
  return json(await getSiteBackground());
};

/** PUT：保存（管理员） */
export const PUT: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: '请求体不合法' }, 400);
  }
  try {
    const saved = await saveSiteBackground({
      enabled: body.enabled === true,
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : '',
      opacity: typeof body.opacity === 'number' ? body.opacity : NaN,
      blur: typeof body.blur === 'number' ? body.blur : NaN,
    });
    return json(saved);
  } catch (err) {
    console.error('[api/background]', err);
    return json({ error: '保存失败' }, 500);
  }
};
