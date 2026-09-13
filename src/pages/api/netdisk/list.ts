/**
 * POST /api/netdisk/list —— 列出网盘目录（管理员）
 *
 * 请求体：{ path: string, page?: number, perPage?: number, refresh?: boolean }
 * 返回：{ ok: true, path, parentPath, items, total }
 *
 * 说明：本站不缓存目录数据（网盘状态实时变化，且刷新成本低）。
 * 底层即 AList `POST /api/fs/list`，因此「列目录」会真正触发厂商驱动
 * （蓝奏云登录态失效时会在这一步暴露，而不是等到上传才报错）。
 */
import type { APIRoute } from 'astro';
import { badJson, guardManager, json, readJson } from '@/lib/api';
import { getNetdiskConfig, isNetdiskReady, normalizeAlistPath } from '@/lib/netdisk-config';
import { alistList, getAlistToken, clearAlistTokenCache } from '@/lib/alist';

export const prerender = false;

/** 路径安全校验：拒绝空、穿越、NUL */
function safePath(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.includes('..') || raw.includes('\0')) return null;
  return normalizeAlistPath(raw);
}

/** 由当前路径推导父目录（根返回 null） */
function parentOf(path: string): string | null {
  if (path === '/' || path === '') return null;
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;

  const body = await readJson<{ path?: string; page?: number; perPage?: number; refresh?: boolean }>(request);
  if (!body) return badJson();

  const cfg = await getNetdiskConfig();
  if (!isNetdiskReady(cfg)) return json({ error: '网盘对接未启用或未配置（请到 设置 → 网盘对接 填写）' }, 400);

  const path = safePath(body.path ?? cfg.managePath);
  if (path === null) return json({ error: '路径不合法' }, 400);

  const page = Number.isFinite(Number(body.page)) && Number(body.page) > 0 ? Math.floor(Number(body.page)) : 1;
  const perPage = Number.isFinite(Number(body.perPage)) && Number(body.perPage) > 0 ? Math.min(Math.floor(Number(body.perPage)), 200) : 100;

  const tokenRes = await getAlistToken(cfg);
  if (!tokenRes.ok) return json({ error: tokenRes.message }, 502);

  let listed = await alistList(cfg.baseUrl, tokenRes.data.token, path, page, perPage, body.refresh === true);
  // token 失效（AList 重启 / 过期）→ 清缓存重试一次
  if (!listed.ok && (listed.code === 401 || listed.code === 403)) {
    clearAlistTokenCache(cfg.baseUrl);
    const retry = await getAlistToken(cfg);
    if (retry.ok) listed = await alistList(cfg.baseUrl, retry.data.token, path, page, perPage, true);
  }
  if (!listed.ok) return json({ error: listed.message }, 502);

  return json({
    ok: true,
    path,
    parentPath: parentOf(path),
    items: listed.data.content ?? [],
    total: listed.data.total ?? 0,
    write: listed.data.write ?? false,
  });
};
