/**
 * 同步引擎对外 API（桌面端唯一入口）
 *
 * - 进程内**互斥**：同一时刻只允许一次同步（重复触发返回 running=true）；
 * - 状态可查：运行中 / 进度 / 最近报告（设置页与托盘共用）；
 * - 依赖装配：本地端点用运行时 db，云端端点用 `SYNC_DATABASE_URL`（+ 可选备库镜像）。
 */
import { serverEnv } from '@/lib/env';
import { db } from '../../db';
import { SqliteEndpoint, type SqliteLikeDb } from './adapters/sqlite-endpoint';
import { PgEndpoint } from './adapters/pg-endpoint';
import { LocalSyncStore } from './local-store';
import { runSync, type SyncProgress } from './engine';
import type { SyncReport } from './core/types';

export type { SyncReport, TableReport, SyncPolicy } from './core/types';
export type { SyncProgress } from './engine';

export interface SyncStatus {
  /** 是否正在同步 */
  running: boolean;
  /** 当前进度（未运行时为 null） */
  progress: SyncProgress | null;
  /** 最近一次同步报告（内存缓存；重启后可由 store.lastReport() 读回） */
  lastReport: SyncReport | null;
  /** 最近一次失败原因（若有） */
  lastError: string | null;
  /** 云端是否已配置（未配置时同步不可用） */
  cloudConfigured: boolean;
}

/** 模块级状态（进程内单例；桌面端是长驻进程，Web 端每次调用会重新初始化 —— 无害） */
const state: SyncStatus = {
  running: false,
  progress: null,
  lastReport: null,
  lastError: null,
  cloudConfigured: false,
};

/** 读状态快照 */
export function syncStatus(): SyncStatus {
  return { ...state };
}

/** 云端连接串（桌面端由主进程从 config.json 注入到环境变量） */
function cloudUrls(): { primary: string | null; fallback: string | null } {
  return {
    primary: serverEnv('SYNC_DATABASE_URL') || null,
    fallback: serverEnv('SYNC_DATABASE_URL_FALLBACK') || null,
  };
}

/** 装配真实端点（本地 SQLite + 云端 PG/备库镜像） */
function buildDeps(onProgress: (p: SyncProgress) => void) {
  const urls = cloudUrls();
  if (!urls.primary) {
    throw new Error('未配置 SYNC_DATABASE_URL（桌面端请在 %APPDATA%\\byqx-blog-desktop\\config.json 填写）');
  }
  state.cloudConfigured = true;
  const warnings: string[] = [];
  return {
    local: new SqliteEndpoint(db as unknown as SqliteLikeDb, 'local'),
    cloud: new PgEndpoint({
      primaryUrl: urls.primary,
      fallbackUrl: urls.fallback ?? undefined,
      onFallbackError: (msg) => {
        warnings.push(msg);
        console.error('[sync]', msg);
      },
    }),
    store: new LocalSyncStore(db as unknown as SqliteLikeDb),
    onProgress,
    warnings,
  };
}

/**
 * 触发一次同步（幂等触发：运行中再次调用不会叠加）
 *
 * @param awaitCompletion true = 等待完成并返回报告（设置页按钮）；false = 立即返回（托盘/启动拉取）
 */
export async function startSync(
  awaitCompletion = true,
): Promise<{ started: boolean; running: boolean; report?: SyncReport; error?: string }> {
  if (state.running) {
    console.log('[sync] 已有同步在执行中，忽略本次触发');
    return { started: false, running: true };
  }

  const warnings: string[] = [];
  state.running = true;
  state.lastError = null;
  state.progress = null;

  console.log('[sync] 收到同步请求');
  const task = (async () => {
    try {
      const deps = buildDeps((p) => {
        state.progress = p;
      });
      console.log('[sync] 云端端点已装配，开始逐表同步');
      const report = await runSync({ ...deps, onProgress: deps.onProgress });
      const pulled = report.perTable.reduce((n, t) => n + t.pulled, 0);
      const pushed = report.perTable.reduce((n, t) => n + t.pushed, 0);
      const skipped = report.perTable.filter((t) => t.skipped).length;
      console.log(`[sync] 完成：拉取 ${pulled} 行，推送 ${pushed} 行，跳过 ${skipped} 表，ok=${report.ok}`);
      if (report.warnings.length > 0) console.log(`[sync] 警告：${report.warnings.slice(0, 2).join(' | ')}`);
      // 备库镜像写失败只作为警告汇总（不改变 ok 判定：主库已成功）
      if (warnings.length > 0) report.warnings.push(...warnings);
      state.lastReport = report;
      return report;
    } catch (err) {
      state.lastError = (err as Error).message;
      console.error(`[sync] 失败：${state.lastError}`);
      throw err;
    } finally {
      state.running = false;
      state.progress = null;
    }
  })();

  if (!awaitCompletion) {
    void task.catch((err) => console.error('[sync] 后台同步失败：', err));
    return { started: true, running: true };
  }
  try {
    const report = await task;
    return { started: true, running: false, report };
  } catch (err) {
    return { started: true, running: false, error: (err as Error).message };
  }
}

/** 首次全量拉取（语义上等同首次 sync：base 为空 → 云端全部行 pull-insert） */
export async function fullPull(): Promise<{ started: boolean; report?: SyncReport; error?: string }> {
  const res = await startSync(true);
  return res.report ? { started: res.started, report: res.report } : { started: res.started, error: res.error };
}
