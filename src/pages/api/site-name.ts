/**
 * GET/PUT /api/site-name —— 站点名称（导航栏品牌文字）
 *
 * - GET：读取当前名称（公开，供客户端即时更新导航栏文字）
 * - PUT：保存名称（管理员，中间件保护）
 *   body: { name: string }
 * - 校验：trim 后非空、≤30 字符；空值/非法值回落默认「白衣卿相」
 */
import type { APIRoute } from 'astro';
import { getSiteName, saveSiteName } from '@/lib/site-name';
import { json } from '@/lib/api';

export const prerender = false;

/** GET：读取 */
export const GET: APIRoute = async () => {
  return json({ name: await getSiteName() });
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
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return json({ error: '名称不能为空' }, 400);
  }
  try {
    const name = await saveSiteName(body.name);
    return json({ name });
  } catch (err) {
    console.error('[api/site-name]', err);
    return json({ error: '保存失败' }, 500);
  }
};
