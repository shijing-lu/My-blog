/** Site-owned provider: preserve proxy model names and never use an ambient API key. */
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type {
  Context,
  Model,
  Message,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { buildChatUrl, type AiConfig } from "./ai-config";
import { createSubscriptionModels, loadChatGptCatalog, subscriptionAvailable, subscriptionOptions } from './pi-subscription';

export async function createSiteAi(cfg: AiConfig) {
  if (cfg.connectionMode === 'subscription') {
    if (!subscriptionAvailable()) throw new Error('订阅接入仅在本地客户端可用');
    const { models, store } = createSubscriptionModels();
    if ((await store.read(cfg.subscriptionProvider))?.type !== 'oauth') throw new Error('请先在 AI 助手设置中登录订阅账号');
    const model = (cfg.subscriptionProvider === 'openai' ? await loadChatGptCatalog(models) : await models.getAvailable(cfg.subscriptionProvider)).find(m => m.id === cfg.subscriptionModel);
    if (!model) throw new Error('所选订阅模型不可用，请重新选择模型');
    return { models, model, options: subscriptionOptions(cfg.subscriptionProvider) };
  }
  const baseUrl = buildChatUrl(cfg.baseUrl).replace(/\/chat\/completions$/, "");
  const model: Model<"openai-completions"> = {
    id: cfg.model,
    name: cfg.model,
    api: "openai-completions",
    provider: "site",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: cfg.editContextTokens,
    maxTokens: cfg.editMaxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
    },
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: "site",
      name: "网站 AI",
      baseUrl,
      models: [model],
      auth: {
        apiKey: {
          name: "网站 API Key",
          resolve: async () => ({ auth: { apiKey: cfg.apiKey } }),
        },
      },
      api: openAICompletionsApi(),
    }),
  );
  return {
    models,
    model,
    options: { apiKey: cfg.apiKey, temperature: cfg.temperature },
  };
}

export async function* streamSiteText(
  cfg: AiConfig,
  context: Context,
  options: SimpleStreamOptions = {},
) {
  const runtime = await createSiteAi(cfg);
  const stream = runtime.models.streamSimple(runtime.model, context, {
    ...runtime.options,
    maxTokens: cfg.maxTokens,
    ...options,
  });
  for await (const event of stream) {
    if (event.type === "text_delta") yield event.delta;
  }
  const result = await stream.result();
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    throw new Error(result.errorMessage || "AI 请求失败或已取消");
  }
  if (result.stopReason === "length")
    throw new Error("AI 输出达到长度限制，请提高输出额度后重试");
}

export async function completeSiteText(
  cfg: AiConfig,
  context: Context,
  options: SimpleStreamOptions = {},
) {
  let text = "";
  for await (const delta of streamSiteText(cfg, context, options))
    text += delta;
  return text;
}

/** Historical assistant records have no billing data; these zero fields are transport metadata only. */
export function siteChatMessages(
  cfg: AiConfig,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Message[] {
  return history.map((m) =>
    m.role === "user"
      ? { role: "user", content: m.content, timestamp: Date.now() }
      : {
          role: "assistant",
          content: [{ type: "text", text: m.content }],
          timestamp: Date.now(),
          api: "openai-completions",
          provider: "site",
          model: cfg.model,
          stopReason: "stop",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        },
  );
}
