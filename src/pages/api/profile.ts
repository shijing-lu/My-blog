/**
 * GET/PUT /api/profile —— 个人中心信息
 *
 * - GET：读取（公开，供首页名片/动态卡片/悬浮框展示）
 * - PUT：保存（管理员，中间件保护）
 */
import type { APIRoute } from 'astro';
import { getProfile, saveProfile } from '@/lib/profile';
import { badJson, badRequest, json, jsonCached, readJson } from '@/lib/api';

export const prerender = false;

/** GET：读取（公开） */
export const GET: APIRoute = async () => {
  return jsonCached(await getProfile());
};

/** PUT：保存（管理员） */
export const PUT: APIRoute = async ({ request }) => {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('请求体不合法');
  }
  try {
    const saved = await saveProfile({
      nickname: typeof body.nickname === 'string' ? body.nickname : undefined,
      avatar: typeof body.avatar === 'string' ? body.avatar : undefined,
      motto: typeof body.motto === 'string' ? body.motto : undefined,
      bio: typeof body.bio === 'string' ? body.bio : undefined,
      location: typeof body.location === 'string' ? body.location : undefined,
    });
    return json(saved);
  } catch (err) {
    console.error('[api/profile]', err);
    return json({ error: '保存失败' }, 500);
  }
};
