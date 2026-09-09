/**
 * GET/PUT /api/image-bed-settings —— GitHub 图床配置（管理员）
 *
 * - GET：读取配置（token 掩码，仅 hasToken 布尔）
 * - PUT：保存配置（token 留空 = 保留原值）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';
import {
  getImageBedConfig,
  saveImageBedConfig,
  serializeImageBedConfig,
  type ImageBedConfig,
} from '@/lib/image-bed';

export const prerender = false;

/** GET：读取配置（掩码） */
export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  try {
    const config = await getImageBedConfig();
    return json(serializeImageBedConfig(config));
  } catch (err) {
    console.error('[api/image-bed-settings] GET', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** PUT：保存配置 */
export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  let body: Partial<ImageBedConfig>;
  try {
    body = (await request.json()) as Partial<ImageBedConfig>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: '请求体不合法' }, 400);
  }
  try {
    const saved = await saveImageBedConfig(body);
    return json(serializeImageBedConfig(saved));
  } catch (err) {
    console.error('[api/image-bed-settings] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};
