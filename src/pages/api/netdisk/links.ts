/**
 * POST /api/netdisk/links —— 递归收集某目录下所有文件的下载直链（管理员，只读）
 *
 * 请求体：{ path: string, maxFiles?: number }
 * 返回：{ ok: true, count, scanned, truncated, text, files }
 *
 * 为什么需要它：AList 的 `fs/get` 对**目录**返回的 `raw_url` 恒为空字符串——
 * 目录没有直链。要「分享一个文件夹」，唯一办法是递归到每个文件逐个取链。
 *
 * 为什么放服务端（而不是前端逐层请求）：需要遍历的目录数不确定，
 * 前端驱动会产生 N 次往返；服务端一次跑完 + 硬超时，行为可控。
 *
 * 硬限制（防 Vercel 函数超时）：MAX_FILES / MAX_MS / MAX_DEPTH，
 * 任一触顶即停并置 `truncated = true`，返回**已收集到的部分**（不整体失败）。
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, isNetdiskReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistGet, alistList, clearAlistTokenCache, getAlistToken, type AlistResult } from '@/lib/alist';

export const prerender = false;

/** 单次最多收集的文件数（每个文件都要一次 fs/get，再多必然超时） */
const MAX_FILES = 200;
/** 整段遍历的墙钟上限（Vercel 函数有执行时长约束，留足余量） */
const MAX_MS = 8_000;
/** 目录递归深度上限（防极端嵌套把时间耗光） */
const MAX_DEPTH = 6;
/** 取直链的并发度（AList 是单机 Go，8 路足够且不会把它打满） */
const CONCURRENCY = 8;
/** 单层目录一次取多少条（AList 的 per_page 上限就是 200） */
const PER_PAGE = 200;

/** 路径安全校验：拒绝空、穿越、NUL */
function safePath(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.includes('..') || raw.includes('\0')) return null;
  return normalizeAlistPath(raw);
}

/** raw_url → 绝对地址（部分驱动返回相对的 `/d/...` 路径） */
function absoluteUrl(baseUrl: string, rawUrl: string): string {
  if (!rawUrl) return '';
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return `${baseUrl.replace(/\/+$/, '')}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
}

/** 收集到的单个文件 */
interface LinkEntry {
  path: string;
  name: string;
  url: string;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{ path?: string; maxFiles?: number }>(request);
  if (!body) return badJson();

  const cfg = await getNetdiskConfig();
  if (!isNetdiskReady(cfg)) return json({ error: '网盘对接未启用或未配置（请到 设置 → 网盘对接 填写）' }, 400);

  const rootPath = safePath(body.path);
  if (rootPath === null) return json({ error: '路径不合法' }, 400);

  const maxFiles =
    Number.isFinite(Number(body.maxFiles)) && Number(body.maxFiles) > 0
      ? Math.min(Math.floor(Number(body.maxFiles)), MAX_FILES)
      : MAX_FILES;

  const tokenRes = await getAlistToken(cfg);
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);
  let token = tokenRes.data.token;

  /** token 失效（AList 重启 / 过期）→ 清缓存重登一次再重试 */
  const withTokenRetry = async <T>(fn: (t: string) => Promise<AlistResult<T>>): Promise<AlistResult<T>> => {
    const first = await fn(token);
    if (!first.ok && (first.code === 401 || first.code === 403)) {
      clearAlistTokenCache(cfg.baseUrl);
      const again = await getAlistToken(cfg);
      if (again.ok) {
        token = again.data.token;
        return fn(token);
      }
    }
    return first;
  };

  const startedAt = Date.now();
  const overTime = (): boolean => Date.now() - startedAt > MAX_MS;
  let truncated = false;
  let scanned = 0;

  /* ---------- 1) BFS 遍历目录树，收集文件路径 ---------- */
  const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }];
  const filePaths: string[] = [];

  while (queue.length > 0) {
    if (filePaths.length >= maxFiles || overTime()) {
      truncated = true;
      break;
    }
    const cur = queue.shift();
    if (!cur) break;

    const listed = await withTokenRetry((t) => alistList(cfg.baseUrl, t, cur.path, 1, PER_PAGE, false));
    if (!listed.ok) {
      // 根目录失败 → 整体失败（前端需要看到明确原因）；子目录失败 → 跳过该分支，不影响其他
      if (cur.depth === 0) return json({ error: listed.message ?? '目录不可访问' }, 502);
      continue;
    }

    const items = listed.data?.content ?? [];
    if ((listed.data?.total ?? 0) > items.length) truncated = true; // 单层超过一页

    for (const it of items) {
      scanned += 1;
      if (!it.is_dir) {
        if (filePaths.length < maxFiles) filePaths.push(`${cur.path.replace(/\/+$/, '')}/${it.name}`);
        else truncated = true;
        continue;
      }
      if (cur.depth + 1 <= MAX_DEPTH) queue.push({ path: `${cur.path.replace(/\/+$/, '')}/${it.name}`, depth: cur.depth + 1 });
      else truncated = true;
    }
  }

  /* ---------- 2) 并发取直链（乱序执行、按原序落位，保证清单顺序稳定）---------- */
  const slots: Array<LinkEntry | null> = new Array<LinkEntry | null>(filePaths.length).fill(null);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= filePaths.length) return;
      if (overTime()) {
        truncated = true;
        return;
      }
      const p = filePaths[i];
      if (p === undefined) return;
      const got = await withTokenRetry((t) => alistGet(cfg.baseUrl, t, p));
      if (!got.ok) continue; // 单个文件失败只跳过，不整体失败
      const url = absoluteUrl(cfg.baseUrl, got.data?.raw_url ?? '');
      if (!url) continue; // 该驱动不支持直链
      slots[i] = { path: p, name: got.data?.name ?? p.slice(p.lastIndexOf('/') + 1), url };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, filePaths.length) }, worker));

  const files = slots.filter((x): x is LinkEntry => x !== null);
  // 服务端直接拼好清单文本，前端复制即可（省一次拼接，也保证格式统一）
  const text = files.map((f) => `${f.name}\n${f.url}`).join('\n\n');

  return json({
    ok: true,
    count: files.length,
    /** 实际扫描到的条目总数（含目录），供前端提示"目录规模" */
    scanned,
    /** 是否因上限截断（文件数 / 单层条数 / 深度 / 耗时） */
    truncated,
    text,
    files,
  });
};
