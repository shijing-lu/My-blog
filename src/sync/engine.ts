/**
 * 同步引擎（编排层）
 *
 * 职责：读镜像 → 读本地 → 读云端 → core 算操作计划 → 两侧落库 → 推进镜像 → 汇总报告。
 * 不负责：SQL 细节（adapters）、合并语义（core）、状态展示（index/UI）。
 *
 * ## 关键工程约束
 * - **逐表串行 + 表级推进**：每张表同步成功后整表推进镜像 → 中断后重跑即断点续传，
 *   已同步完成的表因"三方一致"而零操作（幂等）；
 * - **单表失败不放弃全局**：记入报告的 skipped 并继续下一张表（local-first 下宁可部分成功）；
 * - **镜像仅在成功后推进**：失败表下次重算，不会把错误状态"钉"进 base。
 */
import { planTable, buildSnapshots } from './core/diff';
import { rowHash, rowId, rowUpdatedAt } from './core/hash';
import type { RowSnapshot, SyncPolicy, SyncReport, SyncRow, TableReport } from './core/types';
import type { SyncEndpoint } from './adapters/source';
import type { ConflictRecord, LocalSyncStore } from './local-store';
import { SYNC_POLICIES, tablesMissingPolicy } from './tables';

/** 进度事件（供 UI 轮询/日志） */
export interface SyncProgress {
  table: string;
  index: number;
  total: number;
  phase: 'read' | 'apply' | 'done' | 'skip';
}

export interface SyncDeps {
  /** 本地 SQLite 端点 */
  local: SyncEndpoint;
  /** 云端 PostgreSQL 端点（写操作内部会镜像到备库） */
  cloud: SyncEndpoint;
  /** 本地同步状态存储 */
  store: LocalSyncStore;
  /** 时钟（测试可注入固定时间） */
  now?: () => number;
  /** 进度回调 */
  onProgress?: (p: SyncProgress) => void;
  /** 覆盖策略（默认取注册表；测试用） */
  policies?: SyncPolicy[];
  /** 单表超时（ms，默认 5 分钟）——防止云端半死不活时无限重试挂死 */
  tableTimeoutMs?: number;
  /** 整次同步超时（ms，默认 15 分钟）——超时后剩余表标记为跳过 */
  totalTimeoutMs?: number;
}

/**
 * 判断错误是否属于「云端不可用」类（连接被拒、限额、握手失败）
 *
 * 为什么要单独识别：postgres.js 对连接级失败会**静默重试**，若不快速失败，
 * 界面会永远显示"同步中"。实测触发场景：Prisma Postgres 返回
 * `planLimitReached`（套餐限额）导致所有连接被拒。
 */
function isCloudUnavailable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('planlimitreached') ||
    msg.includes('failed to identify your database') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('超时')
  );
}

/** 给 Promise 套一个超时（超时抛出可读错误） */
async function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）：云端可能不可达`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 云端行写回本地前的兜底补值
 *
 * 场景（实测踩过）：本地 `updated_at` 是 NOT NULL，而其默认值由 drizzle 的
 * `$defaultFn` 在**应用层**给（DDL 里没有 DEFAULT）→ 若某一侧云库缺这一列，
 * `INSERT` 会因 NOT NULL 约束整体失败，整张表都同步不了。
 * 兜底：缺失时用该行的 `created_at`，再退化为当前时间 —— 单边 schema 落后不再阻断同步。
 */
function fillLocalDefaults(row: SyncRow, policy: SyncPolicy, fallbackNow: number): SyncRow {
  if (policy.changeBy !== 'updated_at') return row;
  if (row.updated_at !== undefined && row.updated_at !== null) return row;
  return { ...row, updated_at: row.created_at ?? fallbackNow };
}

/** 行集 → 快照 Map（按策略过滤被排除的行，如 settings.ai_usage） */
function toSnapshots(rows: SyncRow[], policy: SyncPolicy): Map<string, RowSnapshot> {
  const filtered = policy.excludeWhere ? rows.filter((r) => !policy.excludeWhere!(r)) : rows;
  return buildSnapshots(filtered, {
    id: (row) => rowId(row, policy.pk),
    hash: (row) => rowHash(row, policy.columns),
    updatedAt: (row) => rowUpdatedAt(row),
  });
}

/** 执行一次完整同步（首次调用天然等价于"全量拉取"：base 为空 → 云端行全部 pull-insert） */
export async function runSync(deps: SyncDeps): Promise<SyncReport> {
  const now = deps.now ?? (() => Date.now());
  const policies = deps.policies ?? SYNC_POLICIES;
  const startedAt = now();
  const perTable: TableReport[] = [];
  const warnings: string[] = [];

  // 老版本本地库自动升级（幂等建表；失败则后续读写会给出明确错误）
  await deps.store.ensureSchema();

  if (await deps.store.isMirrorEmpty()) {
    warnings.push('首次同步：尚无镜像快照，本次不会传播删除；建立镜像后恢复正常语义。');
  }

  const syncable = policies.filter((p) => p.role !== 'skip' && p.role !== 'local-only');
  const tableTimeoutMs = deps.tableTimeoutMs ?? 5 * 60 * 1000;
  const totalTimeoutMs = deps.totalTimeoutMs ?? 15 * 60 * 1000;
  let cloudDead = false;

  for (let index = 0; index < syncable.length; index += 1) {
    const policy = syncable[index]!;
    const t0 = now();
    const stat: TableReport = {
      table: policy.table,
      pushed: 0,
      pulled: 0,
      deletedLocal: 0,
      deletedRemote: 0,
      conflicts: 0,
      timingMs: 0,
    };

    // 云端已判定不可用 / 整体超时：剩余表直接标记跳过（避免每张表都白等一个超时）
    if (cloudDead || now() - startedAt > totalTimeoutMs) {
      stat.skipped = cloudDead ? '云端不可用，已提前结束' : '整体超时，已提前结束';
      perTable.push(stat);
      deps.onProgress?.({ table: policy.table, index, total: syncable.length, phase: 'skip' });
      continue;
    }

    deps.onProgress?.({ table: policy.table, index, total: syncable.length, phase: 'read' });

    try {
      await withTimeout((async () => {
        const base = await deps.store.loadMirror(policy.table);
        const ours = toSnapshots(await deps.local.readRows(policy.table), policy);
        const theirs = toSnapshots(await deps.cloud.readRows(policy.table), policy);
        const ops = planTable(base, ours, theirs, policy);

        // 分组：两侧的写操作分开攒批，冲突单独留痕
        const localUpserts: SyncRow[] = [];
        const localDeletes: string[] = [];
        const cloudUpserts: SyncRow[] = [];
        const cloudDeletes: string[] = [];
        const conflicts: ConflictRecord[] = [];

        for (const op of ops) {
          switch (op.kind) {
            case 'pull-insert':
            case 'pull-update':
              localUpserts.push(op.row);
              break;
            case 'pull-delete':
              localDeletes.push(op.id);
              break;
            case 'push-insert':
            case 'push-update':
              cloudUpserts.push(op.row);
              break;
            case 'push-delete':
              cloudDeletes.push(op.id);
              break;
            case 'conflict':
              conflicts.push({
                table: policy.table,
                rowId: op.id,
                localJson: JSON.stringify(op.local),
                remoteJson: JSON.stringify(op.remote),
                winner: op.winner,
              });
              break;
          }
        }

        deps.onProgress?.({ table: policy.table, index, total: syncable.length, phase: 'apply' });

        // 本地侧（读快、写少）：先写后删，避免同一行在批内被删掉又插入的歧义
        stat.pulled = await deps.local.upsertRows(
          policy.table,
          localUpserts.map((r) => fillLocalDefaults(r, policy, now())),
          policy.pk,
        );
        stat.deletedLocal = await deps.local.deleteRows(policy.table, localDeletes, policy.pk);
        // 云端侧（含备库镜像写；远端不可达会抛错 → 落入 catch，本表不推进镜像）
        stat.pushed = await deps.cloud.upsertRows(policy.table, cloudUpserts, policy.pk);
        stat.deletedRemote = await deps.cloud.deleteRows(policy.table, cloudDeletes, policy.pk);

        if (conflicts.length > 0) {
          await deps.store.recordConflicts(conflicts);
          stat.conflicts = conflicts.length;
        }

        // 镜像推进：以"应用后的本地行"为新的 base（真实收敛状态）
        await deps.store.saveMirror(policy.table, toSnapshots(await deps.local.readRows(policy.table), policy));
      })(), tableTimeoutMs, `表 ${policy.table}`);
    } catch (err) {
      stat.skipped = (err as Error).message;
      if (stat.skipped.includes('NOT NULL constraint failed')) {
        stat.skipped += '（提示：本地该列非空而云端行缺列 —— 请确认两侧 schema 一致，云端补列见 scripts/pg-add-updated-at.sql）';
      }
      warnings.push(`表 ${policy.table} 同步失败（下次重跑自动续传）：${stat.skipped}`);
      // 连接级故障：后续表不再逐个白等（postgres.js 会静默重试，否则界面永远"同步中"）
      if (isCloudUnavailable(err)) {
        cloudDead = true;
        warnings.push('云端数据库不可用（连接被拒/限额/超时）：本次同步提前结束，本地数据未受影响。');
      }
    }

    stat.timingMs = now() - t0;
    perTable.push(stat);
    deps.onProgress?.({ table: policy.table, index, total: syncable.length, phase: 'done' });
  }

  const report: SyncReport = {
    ok: perTable.every((t) => !t.skipped),
    startedAt,
    finishedAt: now(),
    perTable,
    warnings,
  };
  try {
    await deps.store.writeLog(report);
  } catch (err) {
    console.error('[sync] 写同步日志失败：', err);
  }
  return report;
}

/**
 * 表漂移自检：数据库里有、但策略表里没登记的业务表
 *
 * 用途：新增表忘记登记时给出明确告警（否则该表会静默不参与同步）。
 */
export function detectDrift(allTableNames: string[]): string[] {
  return tablesMissingPolicy(allTableNames);
}
