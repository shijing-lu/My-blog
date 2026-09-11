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
import { getAiConfig, buildChatUrl } from '@/lib/ai-config';

export const prerender = false;

/** 测试请求超时（ms） */
const TEST_TIMEOUT_MS = 15_000;

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  /* 参数全部可选（不传即沿用已保存配置），故宽容解析 */
  const body = await readJsonLoose<{ baseUrl?: string; apiKey?: string; model?: string }>(request);
  try {
    const saved = await getAiConfig();
    const baseUrl =
      typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '' ? body.baseUrl.trim() : saved.baseUrl;
    const model = typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : saved.model;
    // apiKey：表单留空 → 用 DB 已存 Key
    const apiKey =
      typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : saved.apiKey;

    if (!baseUrl || !model || !apiKey) {
      return json({ ok: false, message: '请先填写 API 地址、模型名称和 API Key' });
    }

    const started = Date.now();
    const res = await fetch(buildChatUrl(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      // 常见错误状态给出可读提示
      const hint =
        res.status === 401
          ? 'API Key 无效或未授权'
          : res.status === 404
            ? '接口地址或模型不存在（检查 API 地址/模型名）'
            : res.status === 429
              ? '请求过于频繁（上游限流）'
              : `上游返回 HTTP ${res.status}`;
      return json({ ok: false, message: `${hint}${text ? `：${text}` : ''}`, latencyMs, model });
    }
    return json({ ok: true, message: `连接成功（${latencyMs}ms）`, latencyMs, model });
  } catch (err) {
    console.error('[api/ai/test]', err);
    const msg = err instanceof Error && err.name === 'TimeoutError' ? '连接超时' : '测试失败（网络错误或地址不可达）';
    return json({ ok: false, message: msg });
  }
};
