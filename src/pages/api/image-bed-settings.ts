/**
 * GET/PUT /api/image-bed-settings —— GitHub 图床配置（管理员）
 *
 * - GET：读取配置（token 掩码，仅 hasToken 布尔）
 * - PUT：保存配置（token 留空 = 保留原值）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, readJson } from '@/lib/api';
import {
  getImageBedConfig,
  saveImageBedConfig,
  serializeImageBedConfig,
  type ImageBedConfig,
} from '@/lib/image-bed';

export const prerender = false;

/** GET：读取配置（掩码） */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
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
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<Partial<ImageBedConfig>>(request);
  if (!body) return badJson();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('请求体不合法');
  }
  try {
    const saved = await saveImageBedConfig(body);
    return json(serializeImageBedConfig(saved));
  } catch (err) {
    console.error('[api/image-bed-settings] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};
