/**
 * GET /api/netdisk/chunk-status?task=<taskId> —— 分片合并任务进度查询（管理员）
 *
 * 前端分片上传完成后轮询本接口，读取合并助手写在暂存区 `_merge/<taskId>.result.json`
 * 的进度文件，转成结构化状态返回。浏览器端轮询（而非服务端等待），因为合并 + 跨存储
 * 转存可能持续数分钟，远超 Serverless 函数的执行时长上限。
 *
 * 返回：{ ok: true, status: 'pending' | 'merging' | 'copying' | 'done' | 'error', message? }
 */
import type { APIRoute } from 'astro';
import { guardManager, json } from '@/lib/api';
import { getNetdiskConfig, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistGet, getAlistToken } from '@/lib/alist';

export const prerender = false;

interface MergeResult {
  status?: 'merging' | 'copying' | 'done' | 'error';
  message?: string;
}

export const GET: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const cfg = await getNetdiskConfig();
  if (!cfg.enabled) return json({ error: '网盘对接未启用' }, 400);

  const taskId = (new URL(request.url).searchParams.get('task') ?? '').trim();
  if (!/^[a-zA-Z0-9-]{6,64}$/.test(taskId)) return json({ error: 'taskId 不合法' }, 400);

  const token = await getAlistToken(cfg, 'admin');
  if (!token.ok) return json({ error: token.message }, 502);

  const resultPath = `${normalizeAlistPath(cfg.stagingDir)}/_merge/${taskId}.result.json`;
  const res = await alistGet(cfg.baseUrl, token.data.token, resultPath);
  if (!res.ok) {
    // 结果文件尚不存在 = 助手还没开始处理（仍在排队或助手未安装）
    return json({ ok: true, status: 'pending' }, 200);
  }

  // 经 raw_url 拉取结果文件内容（小 JSON）
  let parsed: MergeResult = {};
  try {
    const text = await (await fetch(res.data.raw_url, { signal: AbortSignal.timeout(10_000) })).text();
    parsed = JSON.parse(text) as MergeResult;
  } catch {
    return json({ ok: true, status: 'pending', message: '进度文件暂不可读' }, 200);
  }

  const status = parsed.status ?? 'pending';
  return json({ ok: true, status, message: parsed.message }, 200);
};
