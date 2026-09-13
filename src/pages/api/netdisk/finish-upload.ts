/**
 * POST /api/netdisk/finish-upload —— 大文件转存收尾（管理员）
 *
 * 请求体：{ stagingPath: string, name?: string }
 * 返回：{ ok: true, dstDir, name, cleaned }
 *
 * 流程（大文件直传的后半段）：
 *   浏览器已直传文件到 AList 暂存目录（本地磁盘，快）
 *     → 本端用**管理员 token** 调 AList 跨存储复制到厂商网盘（如蓝奏云）
 *     → 成功后清理暂存
 *
 * 为什么要「暂存 + 复制」而不是让浏览器直接传厂商网盘：
 *   AList 的蓝奏云驱动上传硬编码 120s 超时，弱网下几十 MB 就会超时失败；
 *   跨存储复制由 AList 内部任务执行，不受浏览器请求时长约束，且可重试。
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, isNetdiskReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistCopy, alistRemove, clearAlistTokenCache, getAlistToken, waitForCopyTasks } from '@/lib/alist';

export const prerender = false;

export const config = { maxDuration: 60 };

/** 文件名安全校验 */
function safeName(input: string): string | null {
  const name = input.trim();
  if (!name || name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  return name.length > 200 ? null : name;
}

/**
 * 清理暂存文件（带重试）
 *
 * 浏览器直传刚结束时文件可能尚未在 AList 侧完全落定，此时删除会失败
 * （实测：直传后立刻删 → 失败；等几十秒再删 → 成功）。故失败时退避重试。
 */
async function removeStagingWithRetry(
  url: string,
  token: string,
  dir: string,
  name: string,
  attempts = 5,
  gapMs = 1200,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const r = await alistRemove(url, token, dir, [name]);
    if (r.ok) return true;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  return false;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{ stagingPath?: string; name?: string }>(request);
  if (!body || typeof body.stagingPath !== 'string') return badJson();

  const cfg = await getNetdiskConfig();
  if (!isNetdiskReady(cfg)) return json({ error: '网盘对接未启用或未配置' }, 400);

  const raw = body.stagingPath.trim();
  if (!raw || raw.includes('..') || raw.includes('\0')) return json({ error: '暂存路径不合法' }, 400);
  const staging = normalizeAlistPath(raw);
  const fileName = safeName(body.name ?? staging.split('/').pop() ?? '');
  if (!fileName) return json({ error: '文件名不合法' }, 400);

  // 暂存文件必须位于配置的暂存目录内（防越权复制其他位置的文件）
  const stagingDir = normalizeAlistPath(cfg.stagingDir);
  const srcDir = staging.slice(0, staging.lastIndexOf('/')) || '/';
  if (srcDir !== stagingDir) {
    return json({ error: `暂存文件必须位于暂存目录 ${stagingDir} 内` }, 400);
  }

  const targetDir = normalizeAlistPath(cfg.targetDir);
  if (targetDir === '/') return json({ error: '请先在设置中指定上传落点目录' }, 400);

  const tokenRes = await getAlistToken(cfg);
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);
  let token = tokenRes.data.token;

  let copied = await alistCopy(cfg.baseUrl, token, stagingDir, targetDir, [fileName]);
  if (!copied.ok && (copied.code === 401 || copied.code === 403)) {
    clearAlistTokenCache(cfg.baseUrl);
    const retry = await getAlistToken(cfg);
    if (retry.ok) {
      token = retry.data.token;
      copied = await alistCopy(cfg.baseUrl, token, stagingDir, targetDir, [fileName]);
    }
  }
  if (!copied.ok) return json({ error: `转存到目标目录失败：${copied.message}` }, 502);

  // 等复制任务结束（大文件为异步任务，任务进行中源文件被占用无法删除）
  const taskIds = (copied.data?.tasks ?? []).map((t) => t?.id).filter((id): id is string => typeof id === 'string' && id !== '');
  const taskDone = await waitForCopyTasks(cfg.baseUrl, token, taskIds);

  // 清理暂存：任务未结束就不删（留给下次或手动清理），避免删到正在复制的源文件；
  // 任务结束后仍需重试 —— 直传刚结束时文件可能尚未完全落定。
  let cleaned = false;
  if (taskDone) {
    cleaned = await removeStagingWithRetry(cfg.baseUrl, token, stagingDir, fileName);
  }

  return json({ ok: true, dstDir: targetDir, name: fileName, cleaned, taskPending: !taskDone });
};
