/**
 * GET/PUT /api/landing —— 落地页 Hero 配置（多图轮播 + 副标题）
 *
 * - GET：读取配置（公开）
 * - PUT：保存配置（管理员，中间件保护）；images 为空 → 恢复用文章封面
 */
import type { APIRoute } from 'astro';
import { getLandingHero, saveLandingHero } from '@/lib/landing';
import { getImage } from '@/lib/images';
import { badJson, badRequest, json, jsonCached, readJson } from '@/lib/api';

export const prerender = false;

/** UUID 格式（图片 id 由 crypto.randomUUID() 生成） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验单个头图 URL，返回错误信息或 null
 * - 空 → 合法（表示使用文章封面）
 * - http(s) 外链 → 合法
 * - /api/images/<uuid> → 校验 id 为 UUID 且图片存在
 * - 其他站内路径 → 合法（兼容）
 */
async function validateHeroImageUrl(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return null;
  if (!imageUrl.startsWith('/api/images/')) return null;
  const id = imageUrl.slice('/api/images/'.length).split('?')[0] ?? '';
  if (!UUID_RE.test(id)) return '图片 id 不合法（应为 UUID）';
  const img = await getImage(id);
  if (!img) return '图片不存在，请重新上传';
  return null;
}

/** GET：读取 */
export const GET: APIRoute = async () => {
  return jsonCached(await getLandingHero());
};

/** PUT：保存（管理员） */
export const PUT: APIRoute = async ({ request }) => {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badJson();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('请求体不合法');
  }
  // 图片列表（兼容旧 imageUrl 单图字段）
  const rawImages = Array.isArray(body.images)
    ? (body.images as unknown[]).filter((u): u is string => typeof u === 'string')
    : typeof body.imageUrl === 'string'
      ? [body.imageUrl]
      : [];
  try {
    for (const url of rawImages) {
      const err = await validateHeroImageUrl(url);
      if (err) return badRequest(err);
    }
    const saved = await saveLandingHero({
      images: rawImages,
      intervalSec: typeof body.intervalSec === 'number' ? body.intervalSec : undefined,
      animation: body.animation === 'break' ? 'break' : 'slide',
      subtitle: typeof body.subtitle === 'string' ? body.subtitle : undefined,
    });
    return json(saved);
  } catch (err) {
    console.error('[api/landing]', err);
    return json({ error: '保存失败' }, 500);
  }
};
