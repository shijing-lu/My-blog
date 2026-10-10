import { it, expect, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { loginChatGpt, refreshChatGpt } from '../src/lib/chatgpt-oauth';
import { subscriptionFailure } from '../src/lib/subscription-errors';
const realFetch = globalThis.fetch;
afterEach(() => vi.unstubAllGlobals());
async function run(wrongNonce: boolean, registration?: { clientId: string; subject: string }, failure?: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-signing-key', alg: 'RS256', use: 'sig' };
  let authorization!: URL;
  let badStatus = 0;
  const clientId = registration?.clientId || 'oaiapp_test';
  const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes('/oauth/token')) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'));
      expect(body.get('client_id')).toBe(clientId);
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'));
      if (failure === 'network') throw TypeError('fetch failed: secret-code secret-token');
      if (failure === 'forbidden') return Response.json({ error: { code: 'untrusted-secret-code', message: 'secret-token' } }, { status: 403 });
      if (failure === 'used-code') return Response.json({ error: 'invalid_grant', error_description: 'secret-code' }, { status: 400 });
      const token = await new SignJWT({ nonce: wrongNonce ? 'bad-nonce' : authorization.searchParams.get('nonce') }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer('https://auth.openai.com').setAudience(clientId).setSubject('verified-account').setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return Response.json({ access_token: 'mock-access', refresh_token: 'mock-refresh', id_token: failure === 'no-identity' ? undefined : token, expires_in: failure === 'incomplete' ? undefined : 3600, scope: failure === 'no-scope' ? 'openid profile email' : 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' });
    }
    if (url.endsWith('/jwks.json')) return failure === 'jwks' ? new Response('secret html response', { status: 403 }) : Response.json({ keys: [jwk] });
    return realFetch(input, init);
  });
  vi.stubGlobal('fetch', mockFetch);
  const result = loginChatGpt({ signal: AbortSignal.timeout(10_000),
    notify(event) {
      if (event.type !== 'auth_url') return;
      authorization = new URL(event.url);
      void (async () => {
        const callback = new URL(authorization.searchParams.get('redirect_uri')!);
        callback.search = new URLSearchParams({ code: 'test-code', state: 'wrong-state', client_id: clientId }).toString();
        badStatus = (await realFetch(callback)).status;
        callback.searchParams.set('state', authorization.searchParams.get('state')!);
        expect((await realFetch(callback)).status).toBe(200);
      })();
    },
    prompt: prompt => new Promise((_resolve, reject) => prompt.signal?.addEventListener('abort', () => reject(Error('manual cancelled')), { once: true })),
  }, { getDeviceId: () => 'd89bd29d-e1f1-4629-bd26-b8657a4437ae' }, registration);
  return { result, getAuthorization: () => authorization, getBadStatus: () => badStatus };
}
it('validates PKCE, callback state and the signed ID token before returning OAuth credentials', async () => {
  const flow = await run(false);
  expect(await flow.result).toMatchObject({ type: 'oauth', clientId: 'oaiapp_test', subject: 'verified-account', access: 'mock-access' });
  expect(flow.getBadStatus()).toBe(400);
  const callback = new URL(flow.getAuthorization().searchParams.get('redirect_uri')!);
  expect(callback.hostname).toBe('127.0.0.1'); expect(callback.pathname).toBe('/auth/callback');
  expect(Number(callback.port)).toBeGreaterThan(0);
});
it('rejects a correctly signed token with a nonce from another authorization attempt', async () => {
  const flow = await run(true); await expect(flow.result).rejects.toMatchObject({ stage: 'identity_validation', code: 'identity_mismatch' });
});
it.each([
  ['network', 'token_exchange', 'network_error'],
  ['forbidden', 'token_exchange', 'request_rejected'],
  ['used-code', 'token_exchange', 'invalid_grant'],
  ['no-scope', 'token_validation', 'plan_scope_missing'],
  ['no-identity', 'identity_validation', 'id_token_missing'],
  ['incomplete', 'token_exchange', 'incomplete_grant'],
  ['jwks', 'identity_validation', 'request_rejected'],
])('reports %s at its actual stage without exposing provider secrets', async (scenario, stage, code) => {
  const flow = await run(false, undefined, scenario);
  const error = await flow.result.catch(error => error);
  const safe = subscriptionFailure(error);
  expect(safe).toMatchObject({ stage, code });
  expect(JSON.stringify(safe)).not.toMatch(/secret|mock-access|mock-refresh|test-code/);
});
it('refreshes through the same transport while preserving the verified account registration', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_id')).toBe('oaiapp_test');
    expect(body.get('refresh_token')).toBe('old-r');
    return Response.json({ access_token: 'rotated', refresh_token: 'rotated-r', expires_in: 3600, scope: 'chatgpt.tokens.use.direct' });
  }));
  expect(await refreshChatGpt({ type: 'oauth', access: 'old', refresh: 'old-r', expires: 1, clientId: 'oaiapp_test', subject: 'verified-account' }, new AbortController().signal)).toMatchObject({ access: 'rotated', refresh: 'rotated-r', clientId: 'oaiapp_test', subject: 'verified-account' });
});
it('reuses the issued client registration without creating another dynamic client', async () => {
  const flow = await run(false, { clientId: 'oaiapp_existing', subject: 'verified-account' });
  expect(await flow.result).toMatchObject({ clientId: 'oaiapp_existing' });
  expect(flow.getAuthorization().searchParams.get('client_id')).toBe('oaiapp_existing');
  expect(flow.getAuthorization().searchParams.has('agent_name_hint')).toBe(false);
});
