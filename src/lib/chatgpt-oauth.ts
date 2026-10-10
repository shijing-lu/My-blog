/** App-owned loopback OAuth; Pi still owns inference and serialized token refresh. */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';
import type { LoginOptions, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { subscriptionFetch } from './subscription-fetch';
import { SubscriptionOAuthError, type OAuthStage } from './subscription-errors';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export type ChatGptRegistration = { clientId: string; subject: string };

async function oauthRequest(url: string | URL, init: RequestInit, stage: OAuthStage) {
  let response: Response;
  try {
    response = await subscriptionFetch(url, { ...init, signal: AbortSignal.any([init.signal || new AbortController().signal, AbortSignal.timeout(30_000)]) });
  } catch {
    init.signal?.throwIfAborted();
    throw new SubscriptionOAuthError(stage, 'network_error', '无法连接 OpenAI，请检查系统代理是否运行及网络连接');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const candidate = typeof body?.error === 'string' ? body.error : body?.error?.code;
    const code = ['invalid_grant', 'invalid_client', 'access_denied', 'unsupported_country_region_territory', 'invalid_refresh_token', 'refresh_token_expired', 'refresh_token_reused'].includes(candidate) ? candidate : 'request_rejected';
    const hint = code === 'invalid_grant' ? '授权码已失效或使用过，请发起一次新的授权'
      : code === 'invalid_client' ? '应用登记无效，请重新连接账号'
      : response.status === 403 ? 'OpenAI 拒绝了连接请求，请检查系统代理出口及账号权限'
      : response.status === 429 ? '请求过于频繁，请稍后重新连接'
      : 'OpenAI 未接受请求，请稍后重新连接';
    throw new SubscriptionOAuthError(stage, code, hint, response.status);
  }
  return response;
}

async function tokenGrant(body: URLSearchParams, signal: AbortSignal, stage: 'token_exchange' | 'token_refresh') {
  const response = await oauthRequest(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body }, stage);
  const token = await response.json().catch(() => { throw new SubscriptionOAuthError(stage, 'invalid_response', 'OpenAI 返回了无法识别的令牌响应'); }) as Record<string, unknown> | null;
  if (!token || typeof token !== 'object' || typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token || typeof token.scope !== 'string' || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new SubscriptionOAuthError(stage, 'incomplete_grant', 'OpenAI 返回的登录凭据不完整，请重新授权');
  const scopes = token.scope.split(/\s+/);
  if (!scopes.includes('chatgpt.tokens.use.direct')) throw new SubscriptionOAuthError('token_validation', 'plan_scope_missing', '账号已授权身份登录，但未授予 ChatGPT 订阅使用权限，请重新授权订阅');
  return { token, credential: { type: 'oauth' as const, access: token.access_token, refresh: token.refresh_token, expires: Date.now() + token.expires_in * 1000 - 180_000, scopes } };
}

/** Pi invokes this inside its serialized credential-store refresh operation. */
export async function refreshChatGpt(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> {
  if (typeof credential.clientId !== 'string' || !credential.clientId) throw new SubscriptionOAuthError('token_refresh', 'client_id_missing', '缺少应用登记，请重新连接');
  const grant = await tokenGrant(new URLSearchParams({ grant_type: 'refresh_token', client_id: credential.clientId, refresh_token: credential.refresh, resource: RESOURCE }), signal, 'token_refresh');
  return { ...credential, ...grant.credential };
}
export async function loginChatGpt(interaction: ProviderAuthInteraction, options?: LoginOptions, registration?: ChatGptRegistration): Promise<OAuthCredential> {
  const deviceId = options?.getDeviceId?.();
  if (!deviceId || !/^[a-f0-9-]{36}$/i.test(deviceId)) throw Error('Missing installation UUID');
  interaction.signal.throwIfAborted();
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  let callbackUri = '';
  let consumed = false;
  let resolveCallback!: (url: URL) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<URL>((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
  // A callback may be cancelled while the listener is being created.
  void callback.catch(() => {});
  function validateCallback(url: URL) {
    const expected = new URL(callbackUri);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.searchParams.get('state') !== state || consumed) throw Error('Invalid or reused authorization callback');
    if (url.searchParams.has('error')) throw Error('ChatGPT authorization was declined');
    if (!url.searchParams.get('code')) throw Error('Missing authorization code');
    const issued = url.searchParams.get('client_id');
    if (registration && issued && issued !== registration.clientId) throw Error('Registration does not match the selected account');
    if (!registration && (!issued || issued === 'dynamic_agent_client')) throw Error('Missing issued client ID');
    consumed = true;
    return url;
  }
  const server = createServer((request, response) => {
    try {
      const url = validateCallback(new URL(request.url || '/', callbackUri));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      response.end('<!doctype html><meta charset="utf-8"><title>白衣卿相</title><p>授权已收到，请返回白衣卿相等待连接完成。可以关闭此窗口。</p>');
      resolveCallback(url);
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('授权回调不匹配、已取消或已使用，请回到应用重新登录。');
      // A stray/wrong-state request must not terminate a valid pending login.
      try {
        const url = new URL(request.url || '/', callbackUri);
        if (url.pathname === '/auth/callback' && url.searchParams.get('state') === state && !consumed && url.searchParams.has('error')) rejectCallback(Error('Authorization declined'));
      } catch { /* An invalid URL is never an authorization result. */ }
    }
  });
  const abort = () => { rejectCallback(Error('Login cancelled')); server.close(); server.closeAllConnections(); };
  interaction.signal.addEventListener('abort', abort, { once: true });
  const manual = new AbortController();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); server.on('error', rejectCallback); resolve(); });
    });
    interaction.signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No callback port');
    callbackUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    url.search = new URLSearchParams({ client_id: registration?.clientId || 'dynamic_agent_client',
      ...(registration ? {} : { agent_name_hint: '白衣卿相' }), ext_agent_host_id: `urn:uuid:${deviceId}`,
      response_type: 'code', redirect_uri: callbackUri, resource: RESOURCE, scope: SCOPES,
      state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    interaction.notify({ type: 'auth_url', url: url.toString(), instructions: '在官方页面授权。若没有自动返回，复制浏览器最终的本地回调地址，粘贴到下方。' });
    const manualResult = interaction.prompt({ type: 'manual_code', message: '也可粘贴授权后的完整回调地址（不是登录页地址）', placeholder: callbackUri,
      signal: AbortSignal.any([manual.signal, interaction.signal]),
    }).then(value => validateCallback(new URL(value.trim())));
    const returned = await Promise.race([callback, manualResult]);
    manual.abort();
    interaction.signal.throwIfAborted();
    const clientId = registration?.clientId || returned.searchParams.get('client_id')!;
    const { token, credential } = await tokenGrant(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: returned.searchParams.get('code')!, code_verifier: verifier, redirect_uri: callbackUri, resource: RESOURCE }), interaction.signal, 'token_exchange');
    if (typeof token.id_token !== 'string' || !token.id_token) throw new SubscriptionOAuthError('identity_validation', 'id_token_missing', '缺少账号身份令牌，请重新授权');
    const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), { [customFetch]: (url, init) => oauthRequest(url, { ...init, signal: interaction.signal }, 'identity_validation') });
    const payload = await jwtVerify(token.id_token, jwks, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5, algorithms: ['RS256', 'ES256'] }).then(r => r.payload).catch(error => {
      interaction.signal.throwIfAborted();
      if (error instanceof SubscriptionOAuthError) throw error;
      throw new SubscriptionOAuthError('identity_validation', 'invalid_id_token', '身份签名或有效期校验未通过，请检查电脑时间并重新授权');
    });
    if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub || (registration && payload.sub !== registration.subject)) throw new SubscriptionOAuthError('identity_validation', 'identity_mismatch', '返回的身份与本次授权或所选账号不匹配，请重新授权');
    interaction.signal.throwIfAborted();
    return { ...credential, clientId, subject: payload.sub };
  } finally {
    manual.abort(); interaction.signal.removeEventListener('abort', abort); server.close(); server.closeAllConnections();
  }
}
