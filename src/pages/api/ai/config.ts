/**
 * GET/PUT /api/ai/config —— AI 助手「小卿」配置（管理员）
 *
 * - GET：读取配置（apiKey 掩码，仅 hasApiKey 布尔）
 * - PUT：保存配置（apiKey 留空 = 保留原值）
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardManager, json, readJson } from '@/lib/api';
import { getAiConfig, saveAiConfig, serializeAiConfig, type AiConfig } from '@/lib/ai-config';
import { SUBSCRIPTION_PROVIDERS } from '@/lib/pi-subscription';

export const prerender = false;

/** GET：读取配置（掩码） */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
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
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJson<Partial<AiConfig>>(request);
  if (!body) return badJson();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('请求体不合法');
  }
  if (body.imageProvider !== undefined && !['openai', 'cloudflare'].includes(body.imageProvider)) return badRequest('封面生图服务不合法');
  if (typeof body.cloudflareAccountId === 'string' && body.cloudflareAccountId.trim() && !/^[a-f0-9]{32}$/i.test(body.cloudflareAccountId.trim())) return badRequest('Cloudflare Account ID 应为 32 位十六进制字符');
  if (body.cloudflareApiToken !== undefined && (typeof body.cloudflareApiToken !== 'string' || body.cloudflareApiToken.length > 300)) return badRequest('Cloudflare API Token 不合法');
  if (body.cloudflareImageSteps !== undefined && (!Number.isInteger(body.cloudflareImageSteps) || body.cloudflareImageSteps < 1 || body.cloudflareImageSteps > 8)) return badRequest('FLUX 生图步数应在 1 到 8 之间');
  if (body.connectionMode !== undefined && !['api', 'subscription'].includes(body.connectionMode)) return badRequest('接入方式不合法');
  if (body.subscriptionProvider !== undefined && !SUBSCRIPTION_PROVIDERS.includes(body.subscriptionProvider as typeof SUBSCRIPTION_PROVIDERS[number])) return badRequest('不支持的订阅提供商');
  try {
    const saved = await saveAiConfig(body);
    return json(serializeAiConfig(saved));
  } catch (err) {
    console.error('[api/ai/config] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};
