/**
 * GET/PUT /api/background —— 全站背景配置
 *
 * - GET：读取配置（公开，供页面渲染与设置页回显）
 * - PUT：保存配置（管理员，中间件保护）；校验背景图为合法 UUID 的站内图片或 http(s) 外链
 */
import type { APIRoute } from 'astro';
import { getSiteBackground, saveSiteBackground } from '@/lib/background';
import { getImage } from '@/lib/images';
import { json } from '@/lib/api';

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
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  try {
    const err = await validateBackgroundImageUrl(imageUrl);
    if (err) return json({ error: err }, 400);
    const saved = await saveSiteBackground({
      enabled: body.enabled === true,
      imageUrl,
      opacity: typeof body.opacity === 'number' ? body.opacity : NaN,
      blur: typeof body.blur === 'number' ? body.blur : NaN,
    });
    return json(saved);
  } catch (err) {
    console.error('[api/background]', err);
    return json({ error: '保存失败' }, 500);
  }
};
