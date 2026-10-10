import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import type { ImageModel, ProviderImages } from '@earendil-works/pi-ai';
import { buildChatUrl, type AiConfig } from './ai-config';

export function imageApiUrl(baseUrl: string) { return buildChatUrl(baseUrl).replace(/\/chat\/completions$/, '/images/generations'); }
export const CLOUDFLARE_FLUX_MODEL = '@cf/black-forest-labs/flux-1-schnell';
export function cloudflareImageRunUrl(accountId: string) {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Cloudflare Account ID 应为 32 位十六进制字符');
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CLOUDFLARE_FLUX_MODEL}`;
}

async function readJsonLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('生图服务返回空响应');
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 24 * 1024 * 1024) throw new Error('生图响应超过大小限制');
      parts.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, any>;
}

/** Pi's custom image-provider extension keeps the saved OpenAI-compatible URL/key. */
export const siteImagesApi: ProviderImages = {
  async generateImages(model, context, options) {
    const base = { api: model.api, provider: model.provider, model: model.id, timestamp: Date.now() };
    try {
      const response = await (options?.fetch || fetch)(model.baseUrl, {
        method: 'POST', signal: options?.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options?.apiKey}` },
        body: JSON.stringify({ model: model.id, prompt: context.input.filter(c => c.type === 'text').map(c => c.text).join('\n'), n: 1, size: '1536x1024' }),
      });
      if (!response.ok) throw new Error(`生图服务返回 HTTP ${response.status}，请检查 URL、模型权限和 API 余额`);
      const result = await readJsonLimited(response) as { data?: { b64_json?: string }[] };
      const data = result.data?.[0]?.b64_json;
      if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('生图服务需返回 data[0].b64_json，请选择支持 GPT Image 的模型');
      return { ...base, stopReason: 'stop', output: [{ type: 'image', data, mimeType: 'image/png' }] };
    } catch (err) {
      return { ...base, stopReason: options?.signal?.aborted ? 'aborted' : 'error', output: [], errorMessage: err instanceof Error && /生图/.test(err.message) ? err.message : '生图请求失败，请检查 API 配置或重试' };
    }
  },
};

/** Cloudflare Workers AI returns the generated JPEG under result.image. */
export const cloudflareImagesApi: ProviderImages = {
  async generateImages(model, context, options) {
    const base = { api: model.api, provider: model.provider, model: model.id, timestamp: Date.now() };
    try {
      const response = await (options?.fetch || fetch)(model.baseUrl, {
        method: 'POST', signal: options?.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options?.apiKey}` },
        body: JSON.stringify({
          prompt: context.input.filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 2048),
          steps: Number(model.headers?.['x-cloudflare-steps'] || 4),
        }),
      });
      if (!response.ok) throw new Error(`Cloudflare 生图请求返回 HTTP ${response.status}，请检查 Account ID、Token 权限和 Workers AI 额度`);
      const result = await readJsonLimited(response) as { result?: { image?: string } };
      const data = result.result?.image;
      if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Cloudflare 生图响应中没有有效的 result.image');
      return { ...base, stopReason: 'stop', output: [{ type: 'image', data, mimeType: 'image/jpeg' }] };
    } catch (err) {
      return { ...base, stopReason: options?.signal?.aborted ? 'aborted' : 'error', output: [], errorMessage: err instanceof Error && /Cloudflare|生图/.test(err.message) ? err.message : 'Cloudflare 生图请求失败，请检查配置或重试' };
    }
  },
};

export async function generateSiteCover(config: AiConfig, prompt: string, signal: AbortSignal) {
  if (config.imageProvider === 'cloudflare') {
    const model: ImageModel<'cloudflare-images'> = {
      type: 'image', id: CLOUDFLARE_FLUX_MODEL, name: 'Cloudflare FLUX.1 Schnell', api: 'cloudflare-images', provider: 'cloudflare-images',
      baseUrl: cloudflareImageRunUrl(config.cloudflareAccountId), input: ['text'], output: ['image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, headers: { 'x-cloudflare-steps': String(config.cloudflareImageSteps) },
    };
    const models = createModels();
    models.setProvider(createProvider({ id: 'cloudflare-images', models: [model],
      auth: { apiKey: { name: 'Cloudflare Workers AI Token', resolve: async () => ({ auth: { apiKey: config.cloudflareApiToken } }) } },
      images: { 'cloudflare-images': cloudflareImagesApi },
    }));
    const result = await models.generateImages(model, { input: [{ type: 'text', text: prompt }] }, { signal });
    const image = result.output.find(c => c.type === 'image');
    if (result.stopReason !== 'stop' || !image || image.type !== 'image') throw new Error(result.errorMessage || 'Cloudflare 未返回图片');
    return Buffer.from(image.data, 'base64');
  }
  const model: ImageModel<'site-images'> = {
    type: 'image', id: config.imageModel, name: config.imageModel, api: 'site-images', provider: 'site-images',
    baseUrl: imageApiUrl(config.baseUrl), input: ['text'], output: ['image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const models = createModels();
  models.setProvider(createProvider({ id: 'site-images', models: [model],
    auth: { apiKey: { name: '网站生图 API', resolve: async () => ({ auth: { apiKey: config.apiKey } }) } },
    images: { 'site-images': siteImagesApi },
  }));
  const result = await models.generateImages(model, { input: [{ type: 'text', text: prompt }] }, { signal });
  const image = result.output.find(c => c.type === 'image');
  if (result.stopReason !== 'stop' || !image || image.type !== 'image') throw new Error(result.errorMessage || '生图服务未返回图片');
  return Buffer.from(image.data, 'base64');
}
