/**
 * GET/PUT /api/ai/config —— AI 助手「小卿」配置（管理员）
 *
 * - GET：读取配置（apiKey 掩码，仅 hasApiKey 布尔）
 * - PUT：保存配置（apiKey 留空 = 保留原值）
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { isManagerSession } from '@/lib/admin-auth';
import { getAiConfig, saveAiConfig, serializeAiConfig, type AiConfig } from '@/lib/ai-config';

export const prerender = false;

/** GET：读取配置（掩码） */
export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  try {
    const config = await getAiConfig();
    return json(serializeAiConfig(config));
  } catch (err) {
    console.error('[api/ai/config] GET', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** PUT：保存配置 */
export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!(await isManagerSession(cookies))) return json({ error: 'unauthorized' }, 401);
  let body: Partial<AiConfig>;
  try {
    body = (await request.json()) as Partial<AiConfig>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: '请求体不合法' }, 400);
  }
  try {
    const saved = await saveAiConfig(body);
    return json(serializeAiConfig(saved));
  } catch (err) {
    console.error('[api/ai/config] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};
