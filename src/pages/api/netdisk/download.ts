/**
 * POST /api/netdisk/download —— 取文件下载直链（管理员）
 *
 * 请求体：{ path: string }
 * 返回：{ ok: true, name, size, url }
 *
 * 关键设计：**本站只返回 URL，不转发文件字节**。
 * AList 的 `raw_url` 自带签名，浏览器可直接拉取（AList 会 302 到厂商 CDN，
 * 或按驱动能力回落为 AList 代理流式）。这样既不受 Vercel 函数 4.5MB 响应体
 * 上限约束，也不消耗本站带宽。
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, isNetdiskReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistGet, clearAlistTokenCache, getAlistToken } from '@/lib/alist';

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
  const tokenRes = await getAlistToken(cfg);
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);

  let got = await alistGet(cfg.baseUrl, tokenRes.data.token, path);
  if (!got.ok && (got.code === 401 || got.code === 403)) {
    clearAlistTokenCache(cfg.baseUrl);
    const retry = await getAlistToken(cfg);
    if (retry.ok) got = await alistGet(cfg.baseUrl, retry.data.token, path);
  }
  if (!got.ok) return json({ error: got.message }, 502);

  const detail = got.data;
  if (detail.is_dir) return json({ error: '目录不能直接下载' }, 400);
  // AList 对部分驱动返回相对路径的 raw_url，补全为绝对地址
  const url = detail.raw_url?.startsWith('http') ? detail.raw_url : `${cfg.baseUrl.replace(/\/+$/, '')}${detail.raw_url ?? ''}`;
  if (!url) return json({ error: '未能获取下载直链（该网盘可能不支持直链）' }, 502);

  return json({ ok: true, name: detail.name, size: detail.size, url });
};
