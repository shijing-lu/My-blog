export type OAuthStage = 'callback' | 'token_exchange' | 'token_validation' | 'identity_validation' | 'token_refresh';
const labels: Record<OAuthStage, string> = { callback: '接收授权', token_exchange: '交换登录令牌', token_validation: '校验授权权限', identity_validation: '校验账号身份', token_refresh: '刷新登录令牌' };
/** Only application-owned messages/codes may reach logs or the settings UI. */
export class SubscriptionOAuthError extends Error {
  constructor(readonly stage: OAuthStage, readonly code: string, hint: string, readonly status?: number) {
    super(`${labels[stage]}失败：${hint}（${code}${status ? `，HTTP ${status}` : ''}）`);
    this.name = 'SubscriptionOAuthError';
  }
}
export function subscriptionFailure(error: unknown): { stage: string; code: string; status?: number; message: string } {
  if (error instanceof SubscriptionOAuthError) return { stage: error.stage, code: error.code, status: error.status, message: error.message };
  const entry = error as { code?: unknown; cause?: unknown } | undefined;
  if (entry?.cause instanceof SubscriptionOAuthError) return subscriptionFailure(entry.cause);
  if (entry?.code === 'auth') return { stage: 'credential_store', code: 'save_failed', message: '授权已完成，但本机凭据保存失败，请检查文件权限或占用后重新连接' };
  return { stage: 'provider', code: 'login_failed', message: '订阅连接失败，请检查网络或重新登录；未保存登录凭据' };
}
