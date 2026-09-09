/**
 * GitHub 图床上传（Contents API）
 *
 * - 命名：`img/<yyyy>/<mm>/<sha256 前 10 位>.<ext>` —— 内容寻址，同图同路径：
 *   幂等（重复上传安全）、天然去重、文件内容永不变（CDN 可 immutable 长缓存）。
 * - API：PUT /repos/{owner}/{repo}/contents/<path>（Fine-grained PAT，仅该仓库 Contents RW）。
 * - 422 = 文件已存在（同内容同路径），视为成功（hash 命名下碰撞概率可忽略）。
 * - 5xx/429/网络错误重试 1 次；单次请求 30s 超时。
 * - 成功返回站内相对路径 `/img/<yyyy>/<mm>/<hash>.<ext>`，由 /img/[...path] 反代回源。
 */
import { createHash } from 'node:crypto';
import type { ImageBedConfig } from './image-bed';

/** MIME → 文件扩展名 */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/** 扩展名 → MIME（反代响应头用） */
export const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** mime → 扩展名（未知类型 null，上层拒绝上传） */
export function mimeToExt(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

/** 单次 API 请求超时（毫秒） */
const GH_TIMEOUT_MS = 30_000;

/** 仓库内路径：img/2026/09/ab12cd34ef.png */
export function ghImagePath(mime: string, buffer: Buffer): string | null {
  const ext = mimeToExt(mime);
  if (!ext) return null;
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 10);
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `img/${yyyy}/${mm}/${hash}.${ext}`;
}

/** 上传结果 */
export type GhUploadResult = { ok: true; path: string } | { ok: false; error: string };

/** GitHub API 公共请求头 */
function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'my-blog-image-bed',
    'x-github-api-version': '2022-11-28',
  };
}

/** 带超时的 fetch（AbortController） */
async function ghFetch(url: string, init: RequestInit, token: string): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, headers: { ...ghHeaders(token), ...(init.headers ?? {}) }, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 错误信息提取（HTTP 状态码 + 响应体片段） */
async function ghError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  let detail = text.slice(0, 200);
  try {
    const j = JSON.parse(text) as { message?: string };
    if (j.message) detail = j.message.slice(0, 200);
  } catch {
    /* 非 JSON 响应，保留原文片段 */
  }
  return `GitHub API ${res.status}: ${detail}`;
}

/**
 * 上传一张图片到 GitHub 仓库。成功返回仓库内相对路径（img/...）。
 * 网络错误/5xx/429 重试一次；422（文件已存在）幂等视为成功。
 */
export async function uploadToGitHub(
  config: ImageBedConfig,
  buffer: Buffer,
  mime: string,
): Promise<GhUploadResult> {
  const path = ghImagePath(mime, buffer);
  if (!path) return { ok: false, error: `不支持的图片类型: ${mime}` };
  if (!config.owner || !config.repo || !config.token) {
    return { ok: false, error: '图床配置不完整（owner/repo/token）' };
  }

  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encoded}`;
  const body = JSON.stringify({
    message: `upload: ${path}`,
    content: buffer.toString('base64'),
    branch: config.branch || 'main',
  });

  let lastNetworkError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ghFetch(url, { method: 'PUT', body }, config.token);
      if (res.status === 200 || res.status === 201) return { ok: true, path };
      // hash 命名：422 = 同内容文件已存在，幂等成功
      if (res.status === 422) return { ok: true, path };
      if (res.status >= 500 || res.status === 429) {
        lastNetworkError = await ghError(res);
        continue; // 重试
      }
      return { ok: false, error: await ghError(res) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastNetworkError = msg.toLowerCase().includes('abort') ? '上传超时（30s）' : `网络错误: ${msg}`;
      if (attempt === 1) return { ok: false, error: lastNetworkError };
    }
  }
  return { ok: false, error: lastNetworkError || 'GitHub API 服务端错误（已重试）' };
}

/** 连接测试结果 */
export type GhTestResult = { ok: boolean; message: string };

/**
 * 测试连接：GET /repos/{owner}/{repo} 验证 token 有效性与仓库可达性。
 * 200 → 仓库可访问；401 → token 无效；404 → 仓库不存在或 token 无该仓库权限。
 */
export async function testGitHubConnection(
  owner: string,
  repo: string,
  token: string,
): Promise<GhTestResult> {
  if (!owner || !repo || !token) return { ok: false, message: 'owner / repo / token 均为必填' };
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const res = await ghFetch(url, { method: 'GET' }, token);
    if (res.status === 200) {
      const data = (await res.json()) as { private?: boolean; default_branch?: string; full_name?: string };
      const visibility = data.private ? '私有' : '公开';
      const branch = data.default_branch ? `，默认分支 ${data.default_branch}` : '';
      return { ok: true, message: `连接成功：${data.full_name ?? `${owner}/${repo}`}（${visibility}仓库${branch}）` };
    }
    if (res.status === 401) return { ok: false, message: 'Token 无效或已过期（GitHub 返回 401）' };
    if (res.status === 404)
      return { ok: false, message: '仓库不存在，或 Token 对该仓库无访问权限（GitHub 返回 404）' };
    return { ok: false, message: await ghError(res) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg.toLowerCase().includes('abort') ? '连接超时（30s）' : `网络错误: ${msg}` };
  }
}
