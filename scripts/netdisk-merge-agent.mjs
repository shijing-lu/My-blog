#!/usr/bin/env node
/**
 * 网盘分片合并助手（My-Blog 网盘对接 · 本机常驻）
 *
 * 职责：轮询暂存区 `_merge/` 目录里的任务文件（由网站「完成上传」接口写入），
 * 自动执行「分片拼接 → 跨存储转存 → 清理」，并写回进度文件供网站轮询。
 *
 * 数据流：
 *   网站(Vercel) --fs/put 小 JSON 任务文件--> AList 暂存区/_merge/<taskId>.json
 *   本助手 --轮询发现--> 拼接分片 -> fs/copy 到目标目录 -> 等任务结束 -> 清理
 *   本助手 --写 _merge/<taskId>.result.json--> 网站 chunk-status 接口轮询读取
 *
 * 安全边界：
 * - 助手只处理 `_merge/*.json` 任务文件，且目标目录不得位于暂存区内（双重校验）；
 * - AList 凭据从本机配置文件读取（与 AList 同级），不经网络传输。
 *
 * 用法：node netdisk-merge-agent.mjs [配置文件路径]
 * 配置文件（默认与本脚本同目录的 netdisk-merge-agent.json）：
 *   { "api": "http://127.0.0.1:5244", "username": "admin", "password": "…",
 *     "stagingDir": "/local/_netdisk_staging", "pollMs": 3000 }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.argv[2] ?? join(SELF_DIR, 'netdisk-merge-agent.json');

if (!existsSync(CONFIG_PATH)) {
  console.error(`[merge-agent] 缺少配置文件：${CONFIG_PATH}`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const API = (cfg.api || 'http://127.0.0.1:5244').replace(/\/+$/, '');
const STAGING = (cfg.stagingDir || '/local/_netdisk_staging').replace(/\/+$/, '');
const TASKS_DIR = `${STAGING}/_merge`;
const POLL_MS = cfg.pollMs ?? 3000;

let token = null;
let tokenAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[merge-agent ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function api(path, init = {}, timeoutMs = 30_000) {
  const res = await fetch(API + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403 || body.code === 401) {
    token = null; // 失效则下次重新登录
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  if (!res.ok || body.code !== 200) throw new Error(body.message || `HTTP ${res.status}`);
  return body.data;
}

async function getToken() {
  if (token && Date.now() - tokenAt < 10 * 60 * 1000) return token;
  const d = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
  });
  token = d.token;
  tokenAt = Date.now();
  return token;
}

const authJson = async (body) => ({ method: 'POST', headers: { 'content-type': 'application/json', authorization: await getToken() }, body: JSON.stringify(body) });

/** 列目录 → name 列表 */
async function listNames(path) {
  const d = await api('/api/fs/list', await authJson({ path, page: 1, per_page: 0, refresh: true }));
  return (d?.content ?? []).map((x) => ({ name: x.name, size: x.size, is_dir: x.is_dir }));
}

/** 读暂存区里的小文本文件（任务/进度） */
async function readSmallFile(path) {
  const d = await api('/api/fs/get', await authJson({ path, password: '' }));
  const res = await fetch(d.raw_url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`读取 ${path} 失败：HTTP ${res.status}`);
  return res.text();
}

/** 写暂存区里的小文本文件（进度） */
async function putSmallFile(path, text) {
  await api('/api/fs/put', {
    method: 'PUT',
    headers: { authorization: await getToken(), 'file-path': encodeURIComponent(path), 'as-task': 'false', 'content-type': 'application/octet-stream' },
    body: text,
  });
}

async function removeNames(dir, names) {
  if (names.length === 0) return;
  await api('/api/fs/remove', await authJson({ dir, names })).catch((e) => log('清理失败（忽略）:', e.message));
}

/** 等待 AList 复制任务全部结束（异步任务，源文件被占用期间不可删） */
async function waitCopyDone(timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await api('/api/task/copy/undone', { method: 'GET', headers: { authorization: await getToken() } }, 15_000);
    if (Array.isArray(d) && d.length === 0) return true;
    await sleep(1500);
  }
  return false;
}

/** 处理单个合并任务 */
async function processTask(taskId) {
  const taskPath = `${TASKS_DIR}/${taskId}.json`;
  const resultPath = `${TASKS_DIR}/${taskId}.result.json`;
  const writeResult = (status, message) => putSmallFile(resultPath, JSON.stringify({ status, message })).catch(() => {});

  let task;
  try {
    task = JSON.parse(await readSmallFile(taskPath));
  } catch (e) {
    log(`任务 ${taskId} 读取失败：`, e.message);
    return false; // 保留任务文件，下轮重试
  }

  const { name, size, targetDir, parts } = task;
  log(`开始任务 ${taskId}：${name}（${(size / 1024 / 1024).toFixed(1)}MB，${parts.length} 片 → ${targetDir}）`);
  await writeResult('merging', '分片合并中');

  try {
    // 基本校验（与网站服务端双重保险）
    if (!name || !Array.isArray(parts) || parts.length === 0) throw new Error('任务内容不完整');
    if (!targetDir || targetDir === '/' || targetDir === STAGING || targetDir.startsWith(`${STAGING}/`)) {
      throw new Error('目标目录不合法');
    }

    // 1) 核对分片齐全
    const existing = await listNames(STAGING);
    const byName = new Map(existing.map((x) => [x.name, x]));
    let total = 0;
    for (const p of parts) {
      const hit = byName.get(p.name);
      if (!hit) throw new Error(`分片缺失：${p.name}`);
      if (Math.abs(hit.size - p.size) > 1) throw new Error(`分片大小不符：${p.name}`);
      total += hit.size;
    }
    if (Math.abs(total - size) > 1) throw new Error(`分片合计 ${total} ≠ 文件大小 ${size}`);

    // 2) 顺序拼接（每片经本地 AList 拉流，磁盘级流式写入，不占大内存）
    //    直接写暂存区物理目录（本地盘），比经 AList 再上传一次快一个量级
    const localRoot = cfg.stagingRoot; // 物理目录（配置里提供，如 C:/alist-storage/_netdisk_staging）
    if (!localRoot) throw new Error('配置缺少 stagingRoot（暂存区物理目录）');
    if (byName.has(name)) await removeNames(STAGING, [name]);
    await pipeline(
      (async function* () {
        for (const p of parts) {
          const d = await api('/api/fs/get', await authJson({ path: `${STAGING}/${p.name}`, password: '' }));
          const res = await fetch(d.raw_url, { signal: AbortSignal.timeout(600_000) });
          if (!res.ok || !res.body) throw new Error(`拉取分片失败：${p.name}（HTTP ${res.status}）`);
          yield* Readable.fromWeb(res.body);
        }
      })(),
      createWriteStream(join(localRoot, name)),
    );
    log(`  拼接完成：${join(localRoot, name)}（${(total / 1024 / 1024).toFixed(1)}MB）`);
    await writeResult('copying', '转存到目标目录');

    // 3) 跨存储转存
    const cp = await api('/api/fs/copy', await authJson({ src_dir: STAGING, dst_dir: targetDir, names: [name] }));
    const ids = (cp?.tasks ?? []).map((t) => t.id).filter(Boolean);
    const done = await waitCopyDone();
    if (!done) log('  ⚠️ 复制任务等待超时（任务仍在后台跑，不阻塞后续）');

    // 4) 清理：分片 + 拼接产物（结果文件留给网站读取，下轮清理）
    await removeNames(STAGING, [...parts.map((p) => p.name), name]);
    await removeNames(TASKS_DIR, [`${taskId}.json`]);
    await writeResult('done', done ? undefined : '复制任务仍在后台进行');
    log(`  ✅ 任务 ${taskId} 完成 → ${targetDir}/${name}`);
  } catch (e) {
    log(`  ❌ 任务 ${taskId} 失败：`, e.message);
    // 失败也清场：删分片，避免垃圾残留（用户需重新上传）
    try {
      const existing = await listNames(STAGING);
      const junk = existing.map((x) => x.name).filter((n) => n === `${name}` || n.startsWith(`${name}.part-`));
      await removeNames(STAGING, junk);
      await removeNames(TASKS_DIR, [`${taskId}.json`]);
    } catch {}
    await writeResult('error', e.message).catch(() => {});
  }
  return true;
}

/** 周期轮询任务目录 */
async function tick() {
  try {
    const items = await listNames(TASKS_DIR);
    // 垃圾清理：结果文件写入 1 小时后删除（网站通常几分钟内就读走了）
    for (const it of items) {
      if (it.name.endsWith('.result.json') && Date.now() - new Date(it.modified).getTime() > 60 * 60 * 1000) {
        await removeNames(TASKS_DIR, [it.name]).catch(() => {});
      }
    }
    for (const it of items) {
      if (it.is_dir || !it.name.endsWith('.json') || it.name.endsWith('.result.json')) continue;
      const taskId = it.name.slice(0, -'.json'.length);
      // 已有结果文件的任务不再处理（结果文件由下轮 garbage 清理）
      const hasResult = items.some((x) => x.name === `${taskId}.result.json`);
      if (hasResult) continue;
      await processTask(taskId);
    }
  } catch (e) {
    // 常见：AList 未启动 / 网络抖动 —— 安静重试
    log('轮询失败（将重试）：', e.message);
  }
}

// 静默死亡是最恶劣的故障形态：任何未捕获异常都只记日志、绝不退出
process.on('unhandledRejection', (r) => log('未处理的 Promise 拒绝（已忽略）:', r?.message ?? String(r).slice(0, 200)));
process.on('uncaughtException', (e) => log('未捕获异常（已忽略）:', e?.message ?? String(e).slice(0, 200)));

log(`启动：API=${API} 暂存区=${STAGING} 轮询=${POLL_MS}ms`);
// 主循环
while (true) {
  await tick();
  await sleep(POLL_MS);
}
