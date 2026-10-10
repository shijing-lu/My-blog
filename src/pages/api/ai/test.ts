/**
 * POST /api/ai/test —— AI 服务连接测试（管理员）
 *
 * 请求体（可选字段，缺省回落 DB 已存配置；apiKey 空 = 用已存 Key）：
 * { baseUrl?, apiKey?, model? }
 *
 * 实现：对上游发一条 stream:false、max_tokens 极小的 chat 请求，2xx 即视为连通。
 * 返回 { ok, message, latencyMs?, model? }。
 */
import type { APIRoute } from 'astro';
import { guardManager, json, readJsonLoose } from '@/lib/api';
import { getAiConfig, normalizeConfig, isAiReady, type AiConfig } from '@/lib/ai-config';
import { isTopAdmin } from '@/lib/admin-auth';

import { createSiteAi } from '@/lib/pi-ai';
import { Type } from '@earendil-works/pi-ai';

export const prerender = false;

/** 测试请求超时（ms） */
const TEST_TIMEOUT_MS = 15_000;

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  /* 参数全部可选（不传即沿用已保存配置），故宽容解析 */
  const body = await readJsonLoose<Partial<AiConfig> & { tools?: boolean }>(request);
  try {
    const saved = await getAiConfig();
    const baseUrl =
      typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '' ? body.baseUrl.trim() : saved.baseUrl;
    const model = typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : saved.model;
    // apiKey：表单留空 → 用 DB 已存 Key
    const apiKey =
      typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : saved.apiKey;

    const config = normalizeConfig({ ...body, baseUrl, model, apiKey, enabled: true }, saved);
    if (config.connectionMode === 'subscription' && !await isTopAdmin(cookies)) return json({ error: '订阅接入仅供站主使用' }, 403);
    if (!isAiReady(config)) {
      return json({ ok: false, message: '请先填写 API 地址、模型名称和 API Key' });
    }

    const started = Date.now();
    const runtime = await createSiteAi(config);
    const toolTest = body.tools === true;
    const response = await runtime.models.completeSimple(runtime.model, {
      systemPrompt: toolTest ? 'Call the site_ping tool exactly once with value="ok". Do not answer in plain text.' : 'Reply with OK.',
      messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
      ...(toolTest ? { tools: [{ name: 'site_ping', description: 'Connection capability probe; no side effects.', parameters: Type.Object({ value: Type.Literal('ok') }) }] } : {}),
    }, { ...runtime.options, maxTokens: toolTest ? 128 : 32, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    const latencyMs = Date.now() - started;
    if (response.stopReason === 'error' || response.stopReason === 'aborted') return json({ ok: false, message: response.errorMessage || 'Pi 请求失败', latencyMs, model });
    if (toolTest && !response.content.some(block => block.type === 'toolCall' && block.name === 'site_ping')) {
      return json({ ok: false, message: '连接可用，但模型未返回有效工具调用，当前模型暂不能用于文章 Agent', latencyMs, model });
    }
    return json({ ok: true, message: `${toolTest ? '工具调用可用' : 'Pi 连接成功'}（${latencyMs}ms）`, latencyMs, model });
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError' ? '连接超时' : err instanceof Error && /请先|所选|订阅接入/.test(err.message) ? err.message : '测试失败（网络、订阅额度或模型不可用，请重新连接后重试）';
    return json({ ok: false, message: msg });
  }
};
