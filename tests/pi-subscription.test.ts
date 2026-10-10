import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../db', () => ({ db: {}, dbWrite: vi.fn() }));
import { normalizeConfig, DEFAULT_AI_CONFIG, DEFAULT_SYSTEM_PROMPT, serializeAiConfig, isAiReady } from '../src/lib/ai-config';
import { LocalSubscriptionStore } from '../src/lib/pi-subscription-store';
import { chatGptSubscriptionPayload, createSubscriptionModels, subscriptionStatus, startSubscriptionLogin, loginView, disconnectSubscription } from '../src/lib/pi-subscription';
import { requiredApiPermission } from '../src/lib/route-permissions';

const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function local() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'byqx-pi-test-')); dirs.push(dir);
  const file = path.join(dir, 'auth.json'); vi.stubEnv('BYQX_PI_AUTH_PATH', file);
  return new LocalSubscriptionStore(file);
}
describe('Pi subscription compatibility and permissions', () => {
  it('preserves legacy API credentials and prompt when switching mode', () => {
    const old = { ...DEFAULT_AI_CONFIG, enabled: true, baseUrl: 'https://relay.example/v1', apiKey: 'private-key', model: 'custom-model', systemPrompt: '不要改这个人设' };
    const sub = normalizeConfig({ connectionMode: 'subscription', subscriptionModel: 'gpt-5.4' }, old);
    expect(sub.baseUrl).toBe(old.baseUrl); expect(sub.apiKey).toBe(old.apiKey);
    expect(sub.model).toBe(old.model); expect(sub.systemPrompt).toBe(old.systemPrompt);
    expect(isAiReady(sub)).toBe(true);
    expect(normalizeConfig({ connectionMode: 'api', apiKey: '' }, sub)).toMatchObject({ ...old, subscriptionModel: 'gpt-5.4' });
    expect(serializeAiConfig(sub)).not.toHaveProperty('apiKey');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('你是「小卿」');
    expect(normalizeConfig({ systemPrompt: '' }, old).systemPrompt).toBe('');
  });
  it('conforms Responses subscription payload without changing tool names or prompts', () => {
    const payload = { model: 'gpt-5.4', max_output_tokens: 128, temperature: 0.7, store: true, previous_response_id: 'old',
      tools: [{ type: 'function', name: 'read_skill', parameters: { type: 'object' } }],
      input: [{ role: 'system', content: 'original prompt' }, { type: 'function_call', name: 'read_skill', call_id: 'x' }, { type: 'function_call_output', call_id: 'x', output: 'skill' }] };
    const result = chatGptSubscriptionPayload(payload);
    expect(result).not.toHaveProperty('max_output_tokens'); expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('previous_response_id'); expect(result).toMatchObject({ store: false, stream: true });
    expect(result.tools).toEqual([{ type: 'namespace', name: 'article_tools', description: 'Local article and skill tools', tools: payload.tools }]);
    expect(result.input).toEqual([{ role: 'developer', content: 'original prompt' }, { ...payload.input[1], namespace: 'article_tools' }, payload.input[2]]);
    expect(payload.store).toBe(true);
  });
  it('does not expose ambient credentials and makes all auth endpoints owner-only', async () => {
    await local(); vi.stubEnv('OPENAI_API_KEY', 'ambient-secret');
    expect(await createSubscriptionModels().models.getAuth('openai')).toBeUndefined();
    for (const method of ['GET', 'POST', 'DELETE']) expect(requiredApiPermission('/api/ai/subscription/', method)).toBe('top');
    expect(requiredApiPermission('/api/ai/cover', 'POST')).toBe('top');
  });
});
describe('Local OAuth credentials', () => {
  it('rotates an expired token once across concurrent Pi runtimes through the scoped subscription transport', async () => {
    const store = await local(); vi.stubEnv('DESKTOP_MODE', '1'); vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890');
    await store.modify('openai', async () => ({ type: 'oauth', access: 'expired', refresh: 'old-r', expires: 1, clientId: 'oaiapp_test', subject: 'verified-account' }));
    const calls = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new URLSearchParams(String(init?.body)).get('grant_type')).toBe('refresh_token');
      expect(init).toHaveProperty('dispatcher');
      await new Promise(resolve => setTimeout(resolve, 15));
      return Response.json({ access_token: 'rotated', refresh_token: 'rotated-r', expires_in: 3600, scope: 'chatgpt.tokens.use.direct' });
    });
    vi.stubGlobal('fetch', calls);
    const auth = await Promise.all(Array.from({ length: 6 }, () => createSubscriptionModels().models.getAuth('openai')));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(auth.every(a => a?.auth.apiKey === 'rotated')).toBe(true);
    expect(await store.read('openai')).toMatchObject({ access: 'rotated', refresh: 'rotated-r', subject: 'verified-account', clientId: 'oaiapp_test' });
  });
  it('offers official ChatGPT authorization, prevents parallel login and cancels without saving', async () => {
    const store = await local(); vi.stubEnv('DESKTOP_MODE', '1');
    const session = await startSubscriptionLogin('openai');
    try {
      await vi.waitFor(() => expect(session.event?.type).toBe('auth_url'));
      const view = loginView(session);
      expect(view).not.toHaveProperty('controller'); expect(view).not.toHaveProperty('answer');
      const event = session.event!;
      if (event.type !== 'auth_url') throw Error('Expected authorization URL');
      const url = new URL(event.url);
      expect(url.origin).toBe('https://auth.openai.com');
      expect(url.searchParams.get('agent_name_hint')).toBe('白衣卿相');
      expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
      await expect(startSubscriptionLogin('anthropic')).rejects.toThrow('已有订阅');
    } finally { session.controller.abort(); await disconnectSubscription('openai'); }
    expect(session.status).toBe('cancelled'); expect(await store.read('openai')).toBeUndefined();
  });
  it('serializes refreshes across independent stores and persists host identity', async () => {
    const a = await local(), b = new LocalSubscriptionStore(a.file);
    const host = await a.hostId(); expect(await b.hostId()).toBe(host);
    await a.modify('openai', async () => ({ type: 'oauth', access: 'secret', refresh: 'r', expires: 1, revision: 0 }));
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).modify('openai', async c => {
      await new Promise(resolve => setTimeout(resolve, 5)); return { ...c!, revision: Number(c?.type === 'oauth' ? c.revision : 0) + 1 } as typeof c;
    })));
    expect(await b.read('openai')).toMatchObject({ revision: 12 });
    const disk = await fs.readFile(a.file, 'utf8'); expect(disk).toContain('secret');
    await a.modify('openai', async c => ({ ...c!, expires: Date.now() + 3600_000 } as typeof c));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] })));
    vi.stubEnv('DESKTOP_MODE', '1'); const status = await subscriptionStatus();
    expect(JSON.stringify(status)).not.toContain('secret'); expect(JSON.stringify(status)).not.toContain('refresh');
    expect(status.providers.find(p => p.id === 'openai')?.models).toEqual([{ id: 'gpt-6.1-sol', name: 'GPT-6.1' }]);
    await b.delete('openai'); expect(await a.read('openai')).toBeUndefined();
  });
  it('preserves tokens on failed refresh and honors cancellation', async () => {
    const a = await local(); await a.modify('openai', async () => ({ type: 'oauth', access: 'old', refresh: 'old-r', expires: 1 }));
    await expect(a.modify('openai', async () => { throw Error('network'); })).rejects.toThrow('network');
    expect(await a.read('openai')).toMatchObject({ access: 'old' });
    await expect(a.modify('openai', async () => undefined, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(await a.read('openai')).toMatchObject({ refresh: 'old-r' });
  });
});
