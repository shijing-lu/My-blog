/**
 * GET/PUT /api/background —— 站点背景配置（统一背景 / 按页面独立）
 *
 * - GET：读取配置（公开，供页面渲染与设置页回显）
 * - PUT：保存配置（管理员，中间件保护）
 *   body: {
 *     mode: 'unified' | 'pages',
 *     enabled?, imageUrl?, opacity?, blur?,   // 统一模式
 *     pages?: { [pageKey]: { imageUrl, opacity, blur } }  // 按页模式
 *   }
 *   所有图 URL 校验：合法 UUID 的站内图片或 http(s) 外链
 */
import type { APIRoute } from 'astro';
import {
  PAGE_KEYS,
  getSiteBackground,
  saveSiteBackground,
  type PageKey,
} from '@/lib/background';
import { getImage } from '@/lib/images';
import { json, jsonCached } from '@/lib/api';

export const prerender = false;

/** UUID 格式（图片 id 由 crypto.randomUUID() 生成） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验背景图 URL，返回错误信息或 null
 * - 空 → 合法（未开启背景）
 * - http(s) 外链 → 合法
 * - /api/images/<uuid> → 校验 id 为 UUID 且图片存在
 * - 其他 → 合法（站内其他路径，兼容）
 */
async function validateBackgroundImageUrl(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return null;
  if (!imageUrl.startsWith('/api/images/')) return null;
  const id = imageUrl.slice('/api/images/'.length).split('?')[0] ?? '';
  if (!UUID_RE.test(id)) return '背景图 id 不合法（应为 UUID）';
  const img = await getImage(id);
  if (!img) return '背景图不存在，请重新上传';
  return null;
}

/** GET：读取 */
export const GET: APIRoute = async () => {
  return jsonCached(await getSiteBackground());
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

  const mode: 'unified' | 'pages' = body.mode === 'pages' ? 'pages' : 'unified';

  try {
    if (mode === 'pages') {
      // 按页模式：校验每页 imageUrl，仅保留白名单键
      const rawPages = body.pages && typeof body.pages === 'object' ? (body.pages as Record<string, unknown>) : {};
      const pages: Partial<Record<PageKey, { imageUrl: string; opacity: number; blur: number }>> = {};
      for (const k of PAGE_KEYS) {
        const p = rawPages[k] as Record<string, unknown> | undefined;
        if (!p || typeof p !== 'object') continue;
        const imageUrl = typeof p.imageUrl === 'string' ? p.imageUrl : '';
        if (!imageUrl) continue;
        const err = await validateBackgroundImageUrl(imageUrl);
        if (err) return json({ error: `页面「${k}」: ${err}` }, 400);
        pages[k] = {
          imageUrl,
          opacity: typeof p.opacity === 'number' ? p.opacity : NaN,
          blur: typeof p.blur === 'number' ? p.blur : NaN,
        };
      }
      const saved = await saveSiteBackground({
        mode: 'pages',
        pages,
        stardust: body.stardust !== false,
      });
      return json(saved);
    }

    // 统一模式
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
    const err = await validateBackgroundImageUrl(imageUrl);
    if (err) return json({ error: err }, 400);
    const saved = await saveSiteBackground({
      mode: 'unified',
      enabled: body.enabled === true,
      imageUrl,
      opacity: typeof body.opacity === 'number' ? body.opacity : NaN,
      blur: typeof body.blur === 'number' ? body.blur : NaN,
      stardust: body.stardust !== false,
    });
    return json(saved);
  } catch (err) {
    console.error('[api/background]', err);
    return json({ error: '保存失败' }, 500);
  }
};
