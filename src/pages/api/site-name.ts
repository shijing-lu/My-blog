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
import { badJson, badRequest, json, readJson } from '@/lib/api';

export const prerender = false;

/** GET：读取 */
export const GET: APIRoute = async () => {
  return json({ name: await getSiteName() });
};

/** PUT：保存（管理员） */
export const PUT: APIRoute = async ({ request }) => {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('请求体不合法');
  }
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return badRequest('名称不能为空');
  }
  try {
    const name = await saveSiteName(body.name);
    return json({ name });
  } catch (err) {
    console.error('[api/site-name]', err);
    return json({ error: '保存失败' }, 500);
  }
};
