/**
 * GET/PUT /api/owner-password —— 站主密码
 *
 * - GET：读取当前口令来源（自定义 / 环境变量）与最近修改时间，供后台展示
 * - PUT：修改站主密码（必须提供当前密码），改完立即生效
 *
 * 仅站主（顶级管理员）可访问：路由权限在 src/lib/route-permissions.ts 登记为 'top'，
 * handler 内再用 guardTopAdmin 做第二道校验。
 *
 * 注意：管理员会话是无服务端状态的 HMAC Cookie，改口令**无法**回收已签发的会话，
 * 其它设备最多在 7 天 TTL 内仍然有效；移动端会话由口令指纹派生，会立即失效。
 */
import type { APIRoute } from 'astro';
import { badJson, badRequest, guardTopAdmin, json, readJson, tooMany } from '@/lib/api';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import {
  ownerPasswordStatus,
  saveOwnerPassword,
  validateNewOwnerPassword,
  verifyOwnerPassword,
} from '@/lib/owner-password';

export const prerender = false;

/** GET：口令状态 */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = await guardTopAdmin(cookies);
  if (denied) return denied;
  try {
    return json(await ownerPasswordStatus());
  } catch (err) {
    console.error('[api/owner-password] GET', err);
    return json({ error: '读取失败' }, 500);
  }
};

/** PUT：修改口令 */
export const PUT: APIRoute = async ({ request, cookies }) => {
  const denied = await guardTopAdmin(cookies);
  if (denied) return denied;

  // 当前密码校验本身是暴力破解入口，按来源限流（10 分钟 5 次）。
  const limit = rateLimit(`owner-password:${clientKey(request)}`, 5, 10 * 60_000);
  if (!limit.ok) return tooMany('尝试过于频繁，请稍后再试', Math.ceil(limit.retryAfterSec));

  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown }>(request);
  if (!body) return badJson();
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!current) return badRequest('请输入当前密码');
  if (!(await verifyOwnerPassword(current))) return badRequest('当前密码不正确');
  const validated = validateNewOwnerPassword(body.newPassword, current);
  if ('error' in validated) return badRequest(validated.error);
  if (typeof body.confirmPassword === 'string' && body.confirmPassword !== validated.password) {
    return badRequest('两次输入的新密码不一致');
  }
  try {
    await saveOwnerPassword(validated.password);
    return json({ ok: true, ...(await ownerPasswordStatus()) });
  } catch (err) {
    console.error('[api/owner-password] PUT', err);
    return json({ error: '保存失败' }, 500);
  }
};
