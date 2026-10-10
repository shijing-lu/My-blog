import type { APIRoute } from 'astro';
import { mobileError, mobileJson, requireMobileOwner } from '../../../../lib/mobile-auth';
import { MobileAuthError } from '../../../../lib/mobile-auth-core';
import { mobileSyncStore, validateOperation } from '../../../../lib/mobile-sync-store';
export const prerender = false;
export const POST: APIRoute = async ({ request }) => {
  try {
    const identity = await requireMobileOwner(request);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1200000) throw new MobileAuthError(413, 'batch_large', '同步批次过大');
    let body;
    try { body = JSON.parse(raw); } catch { throw new MobileAuthError(400, 'invalid_json', '请求格式错误'); }
    if (body?.protocolVersion !== 1 || body.serverId !== identity.serverId || typeof body.cursor !== 'string' || !/^\d{1,10}$/.test(body.cursor) || !Array.isArray(body.operations) || body.operations.length > 50) throw new MobileAuthError(400, 'invalid_envelope', '同步协议或服务身份不兼容');
    const operations = body.operations.map(validateOperation);
    if (new Set(operations.map((o: { opId: string }) => o.opId)).size !== operations.length || new Set(operations.map((o: { recordId: string }) => o.recordId)).size !== operations.length) throw new MobileAuthError(400, 'duplicate_operation', '批次不能重复操作同一记录');
    return mobileJson(await mobileSyncStore().sync(operations, Number(body.cursor)));
  } catch (error) { return mobileError(error); }
};
