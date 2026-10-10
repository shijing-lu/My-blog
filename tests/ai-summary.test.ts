import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
const mock = vi.hoisted(() => ({ read: vi.fn(), mark: vi.fn(), list: vi.fn() }));
vi.mock('../src/lib/admin-auth', () => ({ isTopAdmin: async () => true }));
vi.mock('../src/lib/ai-config', () => ({ getAiConfig: async () => ({ baseUrl: 'https://test.invalid', apiKey: 'test', model: 'test' }), isAiReady: () => true, buildChatUrl: () => 'https://test.invalid/chat' }));
vi.mock('../src/lib/ai-store', () => ({ ensureAiTables: async () => true }));
vi.mock('../src/lib/ai-memory', () => ({ readConversation: mock.read, markSummarized: mock.mark, listConversationMessages: mock.list, parseSummaryJson: () => [], listMemories: async () => [], mergeDrafts: () => ({ fresh: [], dup: [] }), insertMemories: async () => 0, promoteMemories: async () => {} }));
import { POST } from '../src/pages/api/ai/summarize';
const call = () => POST({ request: new Request('https://local.test/api/ai/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: 'test-conversation' }) }), cookies: {} } as APIContext);
const completedSummary = () => new Response('data: {"id":"test-summary","choices":[{"index":0,"delta":{"role":"assistant","content":"[]"},"finish_reason":null}]}\n\ndata: {"id":"test-summary","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
beforeEach(() => {
  vi.clearAllMocks();
  mock.read.mockResolvedValue({ summarized: false, messageCount: 2 });
  mock.list.mockResolvedValue([{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好' }]);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => completedSummary()));
});
afterEach(() => vi.unstubAllGlobals());
describe('摘要费用与重试', () => {
  it('已摘要且无新消息时不调用付费上游', async () => {
    mock.read.mockResolvedValue({ summarized: true, messageCount: 2 });
    expect((await call()).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('无新记忆的成功摘要也标记完成，并使用开始时的消息计数', async () => {
    expect((await call()).status).toBe(200);
    expect(mock.mark).toHaveBeenCalledWith('test-conversation', 2);
  });
  it('同时触发的相同会话只调用一次上游', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async () => { await gate; return completedSummary(); });
    const first = call();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect((await call()).status).toBe(200);
    release();
    await first;
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('上游失败不标记完成，释放锁后允许重试', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 502 }));
    expect((await call()).status).toBe(502);
    expect(mock.mark).not.toHaveBeenCalled();
    expect((await call()).status).toBe(200);
  });
});
