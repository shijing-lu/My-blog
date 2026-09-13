/**
 * POST /api/netdisk/upload —— 小文件上传（经本站函数转发，管理员）
 *
 * 请求：multipart/form-data
 *   - file: 文件（必填）
 *   - dir:  目标目录（可选，缺省用配置里的上传落点目录）
 * 返回：{ ok: true, name, size, dir }
 *
 * 容量边界（本文件是唯一允许文件正文经过 Vercel 函数的路径）：
 * - Vercel 函数请求体硬上限 **4.5MB**（全计划，无法提高）；
 * - 因此 > `smallFileMaxBytes`（默认 4MB）的文件**不要**走这里，
 *   前端应改调 `/api/netdisk/upload-ticket` 走浏览器直传（不受此限制）。
 * - 超过 `maxFileBytes`（厂商网盘单文件上限）直接拒绝。
 */
import type { APIRoute } from 'astro';
import { guardManager, json } from '@/lib/api';
import { getNetdiskConfig, isNetdiskReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistPut, clearAlistTokenCache, getAlistToken } from '@/lib/alist';

export const prerender = false;

export const config = { maxDuration: 60 };

/** 文件名净化：去路径分隔符与控制字符、拒绝穿越、限长 */
function sanitizeFileName(input: string): string {
  const base = (input.split(/[\\/]/).pop() ?? '').trim();
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '');
  const name = cleaned || 'unnamed';
  return name.length > 200 ? name.slice(-200) : name;
}

/** MB 展示（错误文案用） */
function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const cfg = await getNetdiskConfig();
  if (!isNetdiskReady(cfg)) return json({ error: '网盘对接未启用或未配置' }, 400);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '请求格式错误（需 multipart/form-data）' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: '缺少文件字段 file' }, 400);
  if (file.size === 0) return json({ error: '文件为空' }, 400);
  if (file.size > cfg.maxFileBytes) {
    return json({ error: `文件 ${mb(file.size)} 超过单文件上限 ${mb(cfg.maxFileBytes)}（可在设置中调整）` }, 413);
  }
  if (file.size > cfg.smallFileMaxBytes) {
    // 前端应改走直传；这里兜底拒绝，避免撞上 Vercel 4.5MB 硬限制后拿到难懂的 413
    return json(
      {
        error: `文件 ${mb(file.size)} 超过服务器转发上限 ${mb(cfg.smallFileMaxBytes)}，请使用大文件直传`,
        code: 'USE_DIRECT_UPLOAD',
        smallFileMaxBytes: cfg.smallFileMaxBytes,
      },
      413,
    );
  }

  const dirRaw = form.get('dir');
  const dir =
    typeof dirRaw === 'string' && dirRaw.trim() && !dirRaw.includes('..')
      ? normalizeAlistPath(dirRaw)
      : normalizeAlistPath(cfg.targetDir);
  const filename = sanitizeFileName(file.name);

  const tokenRes = await getAlistToken(cfg);
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);

  let put = await alistPut(cfg.baseUrl, tokenRes.data.token, dir, filename, await file.arrayBuffer());
  if (!put.ok && (put.code === 401 || put.code === 403)) {
    clearAlistTokenCache(cfg.baseUrl);
    const retry = await getAlistToken(cfg);
    if (retry.ok) put = await alistPut(cfg.baseUrl, retry.data.token, dir, filename, await file.arrayBuffer());
  }
  if (!put.ok) return json({ error: put.message }, 502);

  return json({ ok: true, name: filename, size: file.size, dir });
};
