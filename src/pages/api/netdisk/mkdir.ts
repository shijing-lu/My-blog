/**
 * POST /api/netdisk/mkdir —— 新建网盘目录（管理员）
 *
 * 请求体：{ path: string }（完整目标路径）
 * 返回：{ ok: true, path }
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, isNetdiskReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistMkdir, clearAlistTokenCache, getAlistToken } from '@/lib/alist';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{ path?: string }>(request);
  if (!body || typeof body.path !== 'string') return badJson();
  const raw = body.path.trim();
  if (!raw || raw.includes('..') || raw.includes('\0')) return json({ error: '路径不合法' }, 400);

  const cfg = await getNetdiskConfig();
  if (!isNetdiskReady(cfg)) return json({ error: '网盘对接未启用或未配置' }, 400);

  const path = normalizeAlistPath(raw);
  if (path === '/') return json({ error: '根目录已存在' }, 400);

  const tokenRes = await getAlistToken(cfg);
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);

  let made = await alistMkdir(cfg.baseUrl, tokenRes.data.token, path);
  if (!made.ok && (made.code === 401 || made.code === 403)) {
    clearAlistTokenCache(cfg.baseUrl);
    const retry = await getAlistToken(cfg);
    if (retry.ok) made = await alistMkdir(cfg.baseUrl, retry.data.token, path);
  }
  if (!made.ok) return json({ error: made.message }, 502);

  return json({ ok: true, path });
};
