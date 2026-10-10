import { it, expect, vi, afterEach } from 'vitest';
import { subscriptionFetch, windowsProxyConfig } from '../src/lib/subscription-fetch';
import { subscriptionOptions } from '../src/lib/pi-subscription';
import { subscriptionFailure, SubscriptionOAuthError } from '../src/lib/subscription-errors';
import { createServer } from 'node:http';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('reads the enabled Windows proxy without changing machine configuration', () => {
  expect(windowsProxyConfig('ProxyEnable REG_DWORD 0x1\r\nProxyServer REG_SZ 127.0.0.1:7890\r\nProxyOverride REG_SZ <local>;*.internal')).toEqual({ httpProxy: 'http://127.0.0.1:7890/', httpsProxy: 'http://127.0.0.1:7890/', noProxy: 'localhost,127.0.0.1,::1,*.internal' });
  expect(windowsProxyConfig('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ 127.0.0.1:7890')).not.toHaveProperty('httpsProxy');
  expect(windowsProxyConfig('ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ http=127.0.0.1:7890;https=127.0.0.1:7891')).toMatchObject({ httpsProxy: 'http://127.0.0.1:7891/' });
});
it('passes a scoped proxy dispatcher and cancellation signal to fetch without replacing global fetch', async () => {
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890');
  const mock = vi.fn<typeof fetch>(async () => new Response('ok'));
  vi.stubGlobal('fetch', mock);
  const signal = new AbortController().signal;
  await subscriptionFetch('https://auth.openai.com/.well-known/jwks.json', { signal });
  expect(mock).toHaveBeenCalledWith('https://auth.openai.com/.well-known/jwks.json', expect.objectContaining({ signal, dispatcher: expect.any(Object) }));
  expect(globalThis.fetch).toBe(mock);
  expect(subscriptionOptions('openai').fetch).toBe(subscriptionFetch);
});
it('keeps real local callback requests working even when the configured proxy is unavailable', async () => {
  vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:9');
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:9');
  const server = createServer((_request, response) => response.end('callback received'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing callback address');
    const response = await subscriptionFetch(`http://127.0.0.1:${address.port}/auth/callback`, { signal: AbortSignal.timeout(3000) });
    expect(await response.text()).toBe('callback received');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('unwraps application diagnostics and masks unknown exceptions', () => {
  const error = new SubscriptionOAuthError('token_exchange', 'invalid_grant', '请重新授权', 400);
  expect(subscriptionFailure({ code: 'auth', cause: error })).toMatchObject({ stage: 'token_exchange', code: 'invalid_grant', status: 400 });
  expect(JSON.stringify(subscriptionFailure(Error('access_token=secret')))).not.toContain('secret');
});
