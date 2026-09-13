/**
 * GET/PUT /api/netdisk-settings —— 网盘对接配置（管理员）
 *
 * GET → 掩码后的配置（含 hasAdminPassword / hasUploaderPassword，明文永不回传）
 * PUT → 保存配置；密码字段留空 = 保留原值（部分更新语义）
 *
 * 存储落 `settings` 表 `netdisk` 键，与 image_bed / ai_config 同模式，无需 DB 迁移。
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, saveNetdiskConfig, serializeNetdiskConfig, type NetdiskConfig } from '@/lib/netdisk-config';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  try {
    const cfg = await getNetdiskConfig();
    return json(serializeNetdiskConfig(cfg));
  } catch (err) {
    console.error('[api/netdisk-settings] GET', err);
    return json({ error: '读取失败' }, 500);
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<Partial<NetdiskConfig>>(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return badJson();
  try {
    const saved = await saveNetdiskConfig(body);
    return json(serializeNetdiskConfig(saved));
  } catch (err) {
    console.error('[api/netdisk-settings] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};
