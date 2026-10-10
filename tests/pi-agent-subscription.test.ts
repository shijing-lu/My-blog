import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>, runs: [] as Record<string, unknown>[],
  article: { id: 'isolated-article', title: '技能测试', slug: 'isolated', content: '# 原文\n\n保留事实。', updatedAt: new Date('2026-10-09'), encrypted: false },
  readSkill: vi.fn(),
}));
vi.mock('../db', () => {
  const select = () => ({ from: () => ({ where: () => ({ limit: async () => [state.article] }) }) });
  return { db: { select }, dbWrite: vi.fn(), getPrimaryDb: () => ({ select, insert: () => ({ values: async (run: Record<string, unknown>) => { state.runs.push(run); } }) }) };
});
vi.mock('../src/lib/ai-config', async original => ({ ...(await original<object>()), getAiConfig: async () => state.config }));
vi.mock('../src/lib/ai-store', () => ({ ensureAiTables: async () => true }));
vi.mock('../src/lib/ai-skills', () => ({ discoverSkills: async () => [{ id: 'note-normalizer', name: '笔记技能' }], skillIdValid: (id: string) => id === 'note-normalizer', readSkill: state.readSkill, readSkillResource: vi.fn() }));
vi.mock('../src/lib/ai-markdown-validation', () => ({ validateAiMarkdown: async () => {} }));
import { DEFAULT_AI_CONFIG } from '../src/lib/ai-config';
import { createSubscriptionModels } from '../src/lib/pi-subscription';
import { LocalSubscriptionStore } from '../src/lib/pi-subscription-store';
import { runDocumentAgent } from '../src/lib/ai-document-agent';

function reply(name?: string, args?: object) {
  const item = name ? { type: 'function_call', id: 'fc_test', call_id: 'call_test', name, namespace: 'article_tools', arguments: JSON.stringify(args), status: 'completed' }
    : { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '已按技能整理，保留原有事实。', annotations: [] }] };
  const response = { id: 'resp_test', model: state.config.subscriptionModel, status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 0 } } };
  const events: object[] = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: name ? { ...item, arguments: '' } : { ...item, content: [] } },
    ...(name ? [{ type: 'response.function_call_arguments.delta', item_id: 'fc_test', output_index: 0, delta: JSON.stringify(args) }, { type: 'response.function_call_arguments.done', item_id: 'fc_test', output_index: 0, arguments: JSON.stringify(args) }]
      : [{ type: 'response.content_part.added', item_id: 'msg_test', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }, { type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, content_index: 0, delta: '已按技能整理，保留原有事实。' }]),
    { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response },
  ];
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); state.runs.length = 0; for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
describe('actual Pi Responses transport and article Agent', () => {
  it('uses OAuth text tools to read current source and mounted skill, then stages a complete candidate', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'byqx-agent-test-')); dirs.push(dir);
    const file = path.join(dir, 'auth.json'); vi.stubEnv('BYQX_PI_AUTH_PATH', file); vi.stubEnv('DESKTOP_MODE', '1');
    await new LocalSubscriptionStore(file).modify('openai', async () => ({ type: 'oauth', access: 'subscription-only-token', refresh: 'test-refresh', expires: Date.now() + 3600_000 }));
    const model = createSubscriptionModels().models.getModels('openai').find(m => m.api === 'openai-responses')!;
    state.config = { ...DEFAULT_AI_CONFIG, enabled: true, connectionMode: 'subscription', subscriptionProvider: 'openai', subscriptionModel: model.id, apiKey: 'do-not-use-api-key' };
    state.readSkill.mockResolvedValue({ id: 'note-normalizer', source: '原始技能：保留所有事实，以清晰段落整理。', version: 'test-version', resources: {} });
    const next = '# 原文\n\n> 保留事实。';
    const queue = [['read_current_document', {}], ['read_skill', { id: 'note-normalizer' }], ['edit_current_document', { content: next }], [undefined, undefined]] as const;
    const payloads: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer subscription-only-token');
      if (String(_input).endsWith('/models')) return Response.json({ models: [{ slug: model.id, display_name: model.name, visibility: 'list' }] });
      const payload = JSON.parse(String(init?.body)); payloads.push(payload);
      expect(payload).not.toHaveProperty('max_output_tokens');
      expect(payload.tools[0].type).toBe('namespace');
      const [tool, args] = queue[payloads.length - 1]!;
      return reply(tool, args);
    }));
    const result = await runDocumentAgent({ domain: 'article', targetId: state.article.id, source: state.article.content, instruction: '按照技能整理内容', scope: 'document', skill: 'note-normalizer' }, AbortSignal.timeout(10_000), () => {});
    expect(result).toMatchObject({ candidate: next, scope: 'document' });
    expect(state.readSkill).toHaveBeenCalledWith('note-normalizer');
    expect(JSON.stringify(payloads[2])).toContain('原始技能');
    expect(state.runs).toHaveLength(1); expect(state.runs[0]).toMatchObject({ before: state.article.content, after: next, status: 'ready' });
    expect(state.article.content).toBe('# 原文\n\n保留事实。');
  });
});
