/**
 * 桌面端同步 API
 *
 * - `POST`：触发一次同步（**非阻塞**：立即返回 started，前端轮询 GET 取进度）；
 * - `GET` ：返回当前状态（运行中 / 进度 / 最近报告 / 云端是否已配置）。
 *
 * 权限：由 `src/middleware.ts` 的 `requiredApiPermission()` 登记为 `settings`（站主/设置权限），
 * 本层再做一次登录守卫（双重防线，避免漏登记时裸奔）。
 */
import type { APIRoute } from 'astro';
import { guardManager, json, serverError } from '@/lib/api';
import { startSync, syncStatus } from '@/sync';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  try {
    return json(syncStatus());
  } catch (err) {
    return serverError('desktop/sync', err, '读取同步状态失败');
  }
};

export const POST: APIRoute = async ({ cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  try {
    const status = syncStatus();
    if (status.running) return json({ started: false, running: true }, 202);
    // 非阻塞启动：长任务在进程内跑，前端轮询 GET /api/desktop/sync
    const res = await startSync(false);
    return json(res, res.started ? 202 : 409);
  } catch (err) {
    return serverError('desktop/sync', err, '启动同步失败');
  }
};
