import type { APIRoute } from 'astro';
import { guardTopAdmin, json, readJson } from '@/lib/api';
import { disconnectSubscription, getLogin, loginView, startSubscriptionLogin, subscriptionStatus } from '@/lib/pi-subscription';
export const prerender = false;
const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'private, no-store' } });

export const GET: APIRoute = async ({ cookies, url }) => {
  const denied = await guardTopAdmin(cookies);
  if (denied) return denied;
  try {
    const id = url.searchParams.get('session');
    if (!id) return reply(await subscriptionStatus());
    const session = getLogin(id);
    return session ? reply(loginView(session)) : reply({ error: '登录会话已过期，请重新发起' }, 404);
  } catch { return reply({ error: '无法读取本地订阅状态，请检查凭据文件权限' }, 500); }
};
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = await guardTopAdmin(cookies);
  if (denied) return denied;
  const body = await readJson<{ action?: string; provider?: string; session?: string; prompt?: string; value?: string; newAccount?: boolean }>(request);
  if (!body) return reply({ error: '请求格式错误' }, 400);
  try {
    if (body.action === 'login' && typeof body.provider === 'string') return reply(loginView(await startSubscriptionLogin(body.provider, body.newAccount === true)));
    if (body.action === 'logout' && typeof body.provider === 'string') {
      await disconnectSubscription(body.provider);
      return reply({ ok: true });
    }
    const session = typeof body.session === 'string' ? getLogin(body.session) : undefined;
    if (!session || session.status !== 'pending') return reply({ error: '没有等待操作的登录会话' }, 409);
    if (body.action === 'cancel') { session.controller.abort(); return reply({ ok: true }); }
    if (body.action === 'answer') {
      if (!session.prompt || session.prompt.id !== body.prompt || typeof body.value !== 'string' || !body.value.trim() || body.value.length > 8192) return reply({ error: '登录步骤已变化，请刷新后重试' }, 409);
      if (session.prompt.type === 'select' && !session.prompt.options.some(o => o.id === body.value)) return reply({ error: '选项无效' }, 400);
      session.answer?.(body.value.trim());
      return reply({ ok: true });
    }
    return reply({ error: '操作不合法' }, 400);
  } catch (error) {
    // Never forward provider responses that may contain authorization codes/tokens.
    const message = error instanceof Error && /已有订阅|不支持|请在本地/.test(error.message) ? error.message : '订阅操作失败，请检查网络或重试';
    return reply({ error: message }, 400);
  }
};
