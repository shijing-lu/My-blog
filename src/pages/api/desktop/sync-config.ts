import type { APIRoute } from 'astro';
import { guardTopAdmin, json } from '@/lib/api';
import { localAppMode, connectionSummary, saveCloudConnections, testCloudConnections, encryptConnections, decryptConnections, cloudConnections, SyncConfigError } from '@/lib/local-sync-config';
import { syncStatus } from '@/sync';
export const prerender = false;
const reply = (value: unknown, status = 200) => json(value, { status, headers: { 'cache-control': 'private, no-store' } });
async function guard(request: Request, cookies: Parameters<typeof guardTopAdmin>[0]) {
  if (!localAppMode() || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) return reply({ error: '此功能仅在本地客户端可用' }, 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: '请求来源不匹配' }, 403);
  const denied = await guardTopAdmin(cookies);
  return denied ? reply({ error: '只有站主可以配置云同步连接' }, 403) : null;
}
export const GET: APIRoute = async ({ request, cookies }) => {
  const denied = await guard(request, cookies); if (denied) return denied;
  return reply(connectionSummary());
};
async function mutate(request: Request, cookies: Parameters<typeof guardTopAdmin>[0], save: boolean) {
  const denied = await guard(request, cookies); if (denied) return denied;
  if (syncStatus().running) return reply({ error: '同步正在进行，请等待完成后再修改或测试连接' }, 409);
  try {
    let input: unknown;
    try { input = await request.json(); } catch { return reply({ error: '请求格式错误' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ error: '请求格式错误' }, 400);
    const body = input as Record<string, unknown>;
    if (save) return reply(await saveCloudConnections(body));
    if (body.action === 'test') return reply(await testCloudConnections(body));
    if (body.action === 'export') return reply(encryptConnections(cloudConnections(), body.password));
    if (body.action === 'import') {
      const connections = decryptConnections(body.envelope, body.password);
      return reply(await saveCloudConnections({ ...connections, clearFallback: !connections.fallbackUrl }));
    }
    return reply({ error: '未知配置操作' }, 400);
  } catch (error) { return reply({ error: error instanceof SyncConfigError ? error.message : '配置操作失败，请重试' }, error instanceof SyncConfigError ? 400 : 500); }
}
export const PUT: APIRoute = ({ request, cookies }) => mutate(request, cookies, true);
export const POST: APIRoute = ({ request, cookies }) => mutate(request, cookies, false);
