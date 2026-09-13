/**
 * POST /api/netdisk/remove —— 删除网盘文件/目录（管理员）
 *
 * 请求体：{ dir: string, names: string[] }
 * 返回：{ ok: true, removed: number }
 *
 * 安全：names 逐项校验（拒绝路径穿越 / 空名），dir 走统一路径规范化。
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, isNetdiskReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistRemove, clearAlistTokenCache, getAlistToken } from '@/lib/alist';

export const prerender = false;

/** 文件名安全校验：拒绝穿越、路径分隔符、空 */
function safeName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  if (!name || name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (name.length > 255) return null;
  return name;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{ dir?: string; names?: unknown }>(request);
  if (!body || typeof body.dir !== 'string') return badJson();
  const rawDir = body.dir.trim();
  if (!rawDir || rawDir.includes('..') || rawDir.includes('\0')) return json({ error: '目录不合法' }, 400);
  if (!Array.isArray(body.names)) return json({ error: 'names 必须为数组' }, 400);

  const names = body.names.map(safeName).filter((n): n is string => n !== null);
  if (names.length === 0) return json({ error: '没有可删除的有效文件名' }, 400);

  const cfg = await getNetdiskConfig();
  if (!isNetdiskReady(cfg)) return json({ error: '网盘对接未启用或未配置' }, 400);

  const dir = normalizeAlistPath(rawDir);
  const tokenRes = await getAlistToken(cfg);
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);

  let done = await alistRemove(cfg.baseUrl, tokenRes.data.token, dir, names);
  if (!done.ok && (done.code === 401 || done.code === 403)) {
    clearAlistTokenCache(cfg.baseUrl);
    const retry = await getAlistToken(cfg);
    if (retry.ok) done = await alistRemove(cfg.baseUrl, retry.data.token, dir, names);
  }
  if (!done.ok) return json({ error: done.message }, 502);

  return json({ ok: true, removed: names.length });
};
