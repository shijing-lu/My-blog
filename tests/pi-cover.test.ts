import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const state = vi.hoisted(() => ({
  article: { id: 'cover-article', title: '文章', content: '完整正文', cover: null as string | null },
  update: vi.fn(), returning: vi.fn(), config: { enabled: true, baseUrl: 'https://api.example/v1', apiKey: 'saved-api-key', imageModel: 'gpt-image-2', editContextTokens: 131072 },
  text: vi.fn(), image: vi.fn(), storage: vi.fn(), bedReady: false, r2: false,
}));
vi.mock('../db', () => ({ db: { update: () => ({ set: state.update }) } }));
vi.mock('../src/lib/articles', () => ({ getArticleById: async () => ({ ...state.article }) }));
vi.mock('../src/lib/ai-config', () => ({ getAiConfig: async () => state.config, isAiReady: () => true, buildChatUrl: (url: string) => `${url.replace(/\/$/, '')}/chat/completions` }));
vi.mock('../src/lib/pi-ai', () => ({ completeSiteText: state.text }));
vi.mock('../src/lib/image-bed', () => ({ getImageBedConfig: async () => ({}), isImageBedReady: () => state.bedReady }));
vi.mock('../src/lib/object-storage', () => ({ r2Enabled: () => state.r2 }));
vi.mock('../src/lib/images', () => ({ storeImage: state.storage, storeImageViaGitHub: vi.fn(), MAX_IMAGE_BYTES: 5242880 }));
vi.mock('../src/lib/gh-image-bed', () => ({ uploadToGitHub: vi.fn() }));
vi.mock('../src/lib/image-transform', () => ({ resizeToWebp: async (buffer: Buffer) => ({ buffer }) }));
import { applyArticleCover, coverBaseline, CoverConflict, createArticleCover } from '../src/lib/ai-article-cover';
import { signPayload } from '../src/lib/auth';
import { siteImagesApi, imageApiUrl } from '../src/lib/pi-image-api';
beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'isolated-cover-signature-test-secret');
  state.article = { id: 'cover-article', title: '文章', content: '完整正文', cover: null };
  state.bedReady = false; state.r2 = false; vi.clearAllMocks();
  state.update.mockReturnValue({ where: () => ({ returning: state.returning }) }); state.returning.mockResolvedValue([{ id: 'cover-article' }]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function token(baseline = coverBaseline(state.article), id = state.article.id) { return signPayload({ purpose: 'ai-article-cover', id, url: '/api/images/generated', baseline, exp: Date.now() + 10000 }); }
describe('API cover storage and concurrency', () => {
  it('checks image storage before any paid request', async () => {
    await expect(createArticleCover(state.article.id, AbortSignal.timeout(1000))).rejects.toThrow('先配置');
    expect(state.text).not.toHaveBeenCalled(); expect(state.storage).not.toHaveBeenCalled();
  });
  it('runs the Pi custom image provider with saved credentials and returns a signed candidate without overwriting the article', async () => {
    state.r2 = true; state.text.mockResolvedValue('文章主题摘要'); state.storage.mockResolvedValue({ id: 'generated-image' });
    const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer saved-api-key');
      expect(JSON.parse(String(init?.body)).prompt).toContain('文章主题摘要');
      return Response.json({ data: [{ b64_json: Buffer.from('mock-image-bytes').toString('base64') }] });
    });
    vi.stubGlobal('fetch', upstream);
    const candidate = await createArticleCover(state.article.id, AbortSignal.timeout(1000));
    expect(candidate).toMatchObject({ url: '/api/images/generated-image', baseline: coverBaseline(state.article) });
    expect(candidate.token).toContain('.'); expect(upstream).toHaveBeenCalledOnce();
    expect(state.text.mock.calls[0]?.[1].messages[0].content).toContain(state.article.content);
    expect(state.storage).toHaveBeenCalledOnce(); expect(state.update).not.toHaveBeenCalled();
  });
  it('updates only cover and timestamp; retains candidate when article changes', async () => {
    const original = token(); state.article.content += '并发修改';
    await expect(applyArticleCover(state.article.id, original)).rejects.toBeInstanceOf(CoverConflict);
    expect(state.update).not.toHaveBeenCalled();
    await applyArticleCover(state.article.id, original, coverBaseline(state.article));
    expect(state.update).toHaveBeenCalledWith({ cover: '/api/images/generated', updatedAt: expect.any(Date) });
  });
  it('refuses a signed token for another article and detects a racing SQL write', async () => {
    await expect(applyArticleCover('another-article', token())).rejects.toThrow('无效');
    expect(state.update).not.toHaveBeenCalled(); state.returning.mockResolvedValue([]);
    await expect(applyArticleCover(state.article.id, token())).rejects.toBeInstanceOf(CoverConflict);
  });
  it('uses the saved image URL/key and does not fetch remote URLs returned by a relay', async () => {
    const model = { type: 'image' as const, id: 'gpt-image-2', name: 'image', api: 'site-images', provider: 'site-images', baseUrl: imageApiUrl('https://api.example/v1'), input: ['text' as const], output: ['image' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const request = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: Buffer.from('fake-bitmap').toString('base64') }] }));
    const result = await siteImagesApi.generateImages(model, { input: [{ type: 'text', text: 'article design' }] }, { apiKey: 'saved-key', fetch: request });
    expect(result.stopReason).toBe('stop'); expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe('https://api.example/v1/images/generations');
    expect(request.mock.calls[0]?.[1].headers.authorization).toBe('Bearer saved-key');
    const remote = vi.fn().mockResolvedValue(Response.json({ data: [{ url: 'http://169.254.169.254/' }] }));
    expect((await siteImagesApi.generateImages(model, { input: [] }, { fetch: remote })).stopReason).toBe('error');
    expect(remote).toHaveBeenCalledOnce();
  });
});
