import { randomUUID, createHash } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai/models';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot';
import type { AuthEvent, AuthPrompt, SimpleStreamOptions, Models, Model, Api } from '@earendil-works/pi-ai';
import { LocalSubscriptionStore, subscriptionFile } from './pi-subscription-store';
import { loginChatGpt, refreshChatGpt } from './chatgpt-oauth';
import { subscriptionFetch } from './subscription-fetch';
import { subscriptionFailure } from './subscription-errors';

export const SUBSCRIPTION_PROVIDERS = ['openai', 'anthropic', 'github-copilot'] as const;
export function subscriptionAvailable() { return process.env.DESKTOP_MODE === '1' || process.env.ANDROID_MODE === '1'; }
export function createSubscriptionModels(newAccount = false) {
  const store = new LocalSubscriptionStore(subscriptionFile());
  const models = createModels({ credentials: store, authContext: { env: async () => undefined, fileExists: async () => false } });
  for (const provider of [openaiProvider(), anthropicProvider(), githubCopilotProvider()]) {
    // Subscription mode must never fall back to a machine's ambient API key.
    const oauth = provider.auth.oauth!;
    models.setProvider({ ...provider, auth: { oauth: provider.id === 'openai' ? {
      ...oauth,
      login: async (interaction, options) => loginChatGpt(interaction, options, newAccount ? undefined : await store.registration()),
      refresh: refreshChatGpt,
    } : oauth } });
  }
  return { models, store };
}

/** ChatGPT plan usage currently requires namespaces and excludes sampling/output caps. */
export function chatGptSubscriptionPayload(payload: unknown) {
  const p = structuredClone(payload) as Record<string, unknown>;
  for (const field of ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id']) delete p[field];
  p.store = false;
  p.stream = true;
  if (Array.isArray(p.tools) && p.tools.length) p.tools = [{ type: 'namespace', name: 'article_tools', description: 'Local article and skill tools', tools: p.tools }];
  if (Array.isArray(p.input)) p.input = p.input.map(item => {
    if (item.role === 'system') return { ...item, role: 'developer' };
    if (item.type === 'function_call' || item.type === 'custom_tool_call') return { ...item, namespace: 'article_tools' };
    return item;
  });
  return p;
}
export function subscriptionOptions(provider: string): SimpleStreamOptions {
  return provider === 'openai' ? { onPayload: chatGptSubscriptionPayload, fetch: subscriptionFetch } : {};
}
const catalogs = new Map<string, { expires: number; models: Model<Api>[] }>();
/** Account-specific catalog, not the SDK's list of all API models. */
export async function loadChatGptCatalog(models: Models) {
  const auth = await models.getAuth('openai');
  if (!auth?.auth.apiKey) return [];
  const key = createHash('sha256').update(auth.auth.apiKey).digest('hex');
  let cached = catalogs.get(key);
  if (!cached || cached.expires < Date.now()) {
    const response = await subscriptionFetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${auth.auth.apiKey}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Error('无法读取订阅账号可用模型，请重新授权或检查网络');
    const catalog = await response.json() as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
    if (!Array.isArray(catalog.models)) throw Error('订阅模型目录格式无效');
    const known = models.getModels('openai');
    const template = known.find(m => m.id === 'gpt-6.1-sol') || known.find(m => m.reasoning);
    if (!template) throw Error('Pi 缺少 Responses 模型配置');
    const entries = catalog.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string' && m.slug.length <= 160).map(m => ({
      ...(known.find(k => k.id === m.slug) || template), id: m.slug!, name: m.display_name || m.slug!,
    }));
    cached = { expires: Date.now() + 300_000, models: entries };
    for (const [id, c] of catalogs) if (c.expires < Date.now()) catalogs.delete(id);
    catalogs.set(key, cached);
  }
  return cached.models;
}

type PromptView = AuthPrompt & { id: string };
type LoginSession = {
  id: string; provider: string; status: 'pending' | 'connected' | 'error' | 'cancelled';
  expiresAt: number; event?: AuthEvent; prompt?: PromptView; error?: string;
  controller: AbortController; answer?: (value: string) => void;
};
const sessions = new Map<string, LoginSession>();
export function loginView(s: LoginSession) {
  const { controller: _controller, answer: _answer, ...view } = s;
  return view;
}
export function getLogin(id: string) { return sessions.get(id); }
export async function startSubscriptionLogin(provider: string, newAccount = false) {
  if (!subscriptionAvailable()) throw new Error('请在本地桌面端或 Android 客户端连接订阅');
  if (!SUBSCRIPTION_PROVIDERS.includes(provider as typeof SUBSCRIPTION_PROVIDERS[number])) throw new Error('不支持的订阅提供商');
  for (const [id, session] of sessions) {
    if (session.expiresAt < Date.now() && session.status !== 'pending') sessions.delete(id);
    if (session.status === 'pending') throw new Error('已有订阅登录正在进行，请先完成或取消');
  }
  const { models, store } = createSubscriptionModels(newAccount);
  const s: LoginSession = { id: randomUUID(), provider, status: 'pending', expiresAt: Date.now() + 600_000, controller: new AbortController() };
  sessions.set(s.id, s);
  let hostId: string;
  try { hostId = await store.hostId(); }
  catch (error) { sessions.delete(s.id); throw error; }
  const timer = setTimeout(() => s.controller.abort(), 600_000);
  timer.unref?.();
  void models.login(provider, 'oauth', {
    signal: s.controller.signal,
    notify(event) {
      if (event.type === 'auth_url' && provider === 'openai') {
        const url = new URL(event.url);
        if (url.searchParams.get('client_id') === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', '白衣卿相');
        s.event = { ...event, url: url.toString() };
      } else if (event.type === 'auth_url' || event.type === 'device_code' || !s.event) s.event = event;
    },
    prompt(prompt) {
      return new Promise<string>((resolve, reject) => {
        const id = randomUUID();
        const { signal, ...view } = prompt;
        s.prompt = { ...view, id };
        const cleanup = () => {
          signal?.removeEventListener('abort', cancel);
          s.controller.signal.removeEventListener('abort', cancel);
          if (s.prompt?.id === id) { delete s.prompt; delete s.answer; }
        };
        const cancel = () => { cleanup(); reject(new Error('登录已取消')); };
        s.answer = value => { cleanup(); resolve(value); };
        signal?.addEventListener('abort', cancel, { once: true });
        s.controller.signal.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted || s.controller.signal.aborted) cancel();
      });
    },
  }, { getDeviceId: () => hostId }).then(() => {
    s.status = 'connected';
    delete s.event;
  }).catch(error => {
    const failure = subscriptionFailure(error);
    if (!s.controller.signal.aborted) console.warn('[pi/oauth] login failed', failure.stage, failure.code, failure.status || '');
    s.status = s.controller.signal.aborted ? 'cancelled' : 'error';
    s.error = s.status === 'cancelled' ? '登录已取消或超时' : failure.message;
    delete s.event;
  }).finally(() => { clearTimeout(timer); delete s.prompt; delete s.answer; });
  return s;
}
export async function subscriptionStatus() {
  const { models, store } = createSubscriptionModels();
  const saved = subscriptionAvailable() ? await store.list() : [];
  return {
    available: subscriptionAvailable(),
    login: [...sessions.values()].find(s => s.status === 'pending') ? loginView([...sessions.values()].find(s => s.status === 'pending')!) : undefined,
    providers: await Promise.all(models.getProviders().map(async provider => {
      const connected = saved.some(c => c.providerId === provider.id && c.type === 'oauth');
      let availableModels: readonly Model<Api>[] = [], error: string | undefined;
      if (connected) {
        try { availableModels = provider.id === 'openai' ? await loadChatGptCatalog(models) : await models.getAvailable(provider.id); }
        catch { error = '模型目录读取失败，请检查网络或重新授权'; }
      }
      return { id: provider.id, name: provider.id === 'openai' ? 'ChatGPT' : provider.name, connected,
        models: availableModels.map(m => ({ id: m.id, name: m.name })), error };
    })),
  };
}
export async function disconnectSubscription(provider: string) {
  for (const s of sessions.values()) if (s.provider === provider && s.status === 'pending') s.controller.abort();
  // Models.login observes abort before writing a credential; wait for its cleanup.
  for (const s of sessions.values()) if (s.provider === provider) {
    while (s.status === 'pending') await new Promise(resolve => setTimeout(resolve, 20));
  }
  await createSubscriptionModels().models.logout(provider);
}
