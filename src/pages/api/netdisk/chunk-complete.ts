/**
 * 分片直传·任务下达
 *
 * 大文件（>Cloudflare 单请求上限 100MB）无法一次直传中转层，前端会切成
 * 若干 <95MB 的分片传到暂存区，然后调用本接口「下达合并任务」：
 * 服务端把任务描述写入暂存区的 `_merge/<taskId>.json`，由用户本机常驻的
 * 合并助手（netdisk-merge-agent）轮询发现后自动执行「拼接 → 跨存储转存 → 清理」。
 *
 * 为什么这样设计：合并必须发生在用户本机（分片在那里），但本机没有公网入站；
 * 借助 AList 本身作为「指令通道」（写一个小 JSON 文件），无需新增隧道端口或公网组件。
 *
 * 请求体：{ taskId, name, size, parts: Array<{ name: string; size: number }>, targetDir: string }
 * 返回：{ ok: true, taskPath }
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistGet, alistMkdir, alistPut, getAlistToken } from '@/lib/alist';

export const prerender = false;

/** 分片名约束：`<原文件名>.part-NNN`（NNN 三位序号），防止借任务通道读写任意文件 */
const PART_NAME_RE = /\.part-\d{3}$/;

/** 单个任务文件很小，普通超时足够 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{
    taskId?: string;
    name?: string;
    size?: number;
    parts?: Array<{ name?: string; size?: number }>;
    targetDir?: string;
  }>(request);
  if (!body) return badJson();

  const cfg = await getNetdiskConfig();
  if (!cfg.enabled) return json({ error: '网盘对接未启用' }, 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
  const size = Number(body.size);
  const parts = Array.isArray(body.parts) ? body.parts : [];
  const targetDir = typeof body.targetDir === 'string' ? normalizeAlistPath(body.targetDir) : '';
  const stagingDir = normalizeAlistPath(cfg.stagingDir);

  if (!taskId || !/^[a-zA-Z0-9-]{6,64}$/.test(taskId)) return json({ error: 'taskId 不合法' }, 400);
  if (!name || name.includes('/') || name.includes('\\') || name.length > 200) return json({ error: '文件名不合法' }, 400);
  if (!Number.isFinite(size) || size <= 0) return badJson();
  if (size > cfg.maxFileBytes) return json({ error: `超过单文件上限 ${Math.round(cfg.maxFileBytes / 1024 / 1024)}MB` }, 400);
  if (parts.length === 0 || parts.length > 200) return json({ error: '分片列表不合法' }, 400);
  if (!targetDir || targetDir === '/') return json({ error: '目标目录不合法' }, 400);
  if (targetDir === stagingDir || targetDir.startsWith(`${stagingDir}/`)) {
    return json({ error: '目标目录不能位于暂存区内' }, 400);
  }

  const cleanParts: Array<{ name: string; size: number }> = [];
  let total = 0;
  for (const p of parts) {
    const pn = typeof p?.name === 'string' ? p.name : '';
    const ps = Number(p?.size);
    if (!pn.startsWith(`${name}.part-`) || !PART_NAME_RE.test(pn) || !Number.isFinite(ps) || ps <= 0) {
      return json({ error: '分片信息不合法' }, 400);
    }
    total += ps;
    cleanParts.push({ name: pn, size: ps });
  }
  // 分片总量与声称大小须一致（±1 字节容差防浮点/取整误差）
  if (Math.abs(total - size) > 1) return json({ error: `分片大小合计 (${total}) 与文件大小 (${size}) 不符` }, 400);

  const token = await getAlistToken(cfg, 'admin');
  if (!token.ok) return json({ error: token.message }, 502);

  // 任务文件内容刻意精简：不含任何凭据（合并助手用本机配置文件里的账号登录 AList）
  const task = { v: 1, name, size, targetDir, parts: cleanParts, createdAt: new Date().toISOString() };
  const taskPath = `${stagingDir}/_merge/${taskId}.json`;
  // _merge 目录不存在则创建（幂等；首次使用分片直传时触发）
  await alistMkdir(cfg.baseUrl, token.data.token, `${stagingDir}/_merge`);
  const put = await alistPut(cfg.baseUrl, token.data.token, `${stagingDir}/_merge`, `${taskId}.json`, JSON.stringify(task));
  if (!put.ok) return json({ error: `写入合并任务失败：${put.message}` }, 502);

  // 回读校验：确保任务文件真的落盘（写失败时尽早暴露，避免用户干等）
  const check = await alistGet(cfg.baseUrl, token.data.token, taskPath);
  if (!check.ok) return json({ error: '合并任务写入后不可见，中转层可能异常' }, 502);

  return json({ ok: true, taskPath, statusPath: `${stagingDir}/_merge/${taskId}.result.json` }, 200);
};
