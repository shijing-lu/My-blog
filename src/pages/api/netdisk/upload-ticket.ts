/**
 * POST /api/netdisk/upload-ticket —— 签发浏览器直传凭证（管理员）
 *
 * 请求体：{ name: string, size?: number }
 * 返回：{ ok: true, uploadUrl, token, filePath, stagingPath, maxBytes }
 *
 * 为什么要有这一步：> 4MB 的文件不能经 Vercel 函数（4.5MB 硬上限），
 * 必须由浏览器**直连 AList** 上传。但 AList 的管理员 token 不能下发浏览器
 * （等于交出网盘控制权），所以这里下发的是 **AList 侧受限子账号**的 token：
 * 该账号只能写暂存目录，即使泄露攻击面也被限制在暂存目录内。
 *
 * ⚠️ 前提：AList ≥ 3.57.0（旧版 CVE-2026-25161 可用 `../` 绕过子账号路径限制）。
 *
 * 安全细节：
 * - filePath 由服务端拼接并净化（去穿越 / 路径分隔符 / 控制字符），浏览器不能指定目录；
 * - size 超限直接拒绝（厂商单文件上限）；
 * - 上传目标固定为 stagingDir（本地暂存），由 finish-upload 再跨存储复制到厂商网盘，
 *   这样绕开 AList 蓝奏驱动的 120s 硬超时。
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, isNetdiskDirectUploadReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { getAlistToken } from '@/lib/alist';

export const prerender = false;

/** 文件名净化：去路径分隔符与控制字符、拒绝前导点、限长 */
function sanitizeFileName(input: string): string {
  const base = (input.split(/[\\/]/).pop() ?? '').trim();
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '');
  const name = cleaned || 'unnamed';
  return name.length > 200 ? name.slice(-200) : name;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{ name?: string; size?: number }>(request);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return badJson();

  const cfg = await getNetdiskConfig();
  if (!isNetdiskDirectUploadReady(cfg)) {
    return json({ error: '大文件直传不可用：请在设置中配置中转服务地址与受限子账号（uploader）' }, 400);
  }

  const size = Number(body.size);
  if (Number.isFinite(size) && size > cfg.maxFileBytes) {
    return json({ error: `文件超过单文件上限 ${Math.round(cfg.maxFileBytes / 1024 / 1024)}MB` }, 413);
  }

  const filename = sanitizeFileName(body.name);
  const stagingDir = normalizeAlistPath(cfg.stagingDir);
  if (stagingDir === '/') return json({ error: '暂存目录不能为根目录（请在设置中指定）' }, 400);
  const filePath = `${stagingDir}/${filename}`;

  // 只下发**受限子账号** token（不是管理员 token）
  const tokenRes = await getAlistToken(cfg, 'uploader');
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);

  return json({
    ok: true,
    /** 浏览器应 PUT 到该地址（AList 上传端点） */
    uploadUrl: `${cfg.baseUrl.replace(/\/+$/, '')}/api/fs/put`,
    token: tokenRes.data.token,
    filePath,
    stagingPath: filePath,
    maxBytes: cfg.maxFileBytes,
  });
};
