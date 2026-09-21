/**
 * 同步引擎核心类型（纯类型，零依赖）
 *
 * 术语约定（类比 Git）：
 * - `base`   = 上次同步的**镜像快照**（本地 sync_mirror 表）；
 * - `ours`   = 本地 SQLite 当前行集（桌面端主库）；
 * - `theirs` = 云端 PostgreSQL 当前行集（Web 端所用同一库）。
 * 三方对比即可判定「谁新增 / 谁修改 / 谁删除」，无需在业务表里加软删除列。
 */

/** 同步角色 */
export type SyncRole =
  /** 站主内容：双方都可能改，按 updated_at 取新者（LWW） */
  | 'lww'
  /** 追加型（评论/点赞/浏览量/记录）：按主键并集补缺失，不覆盖既有行 */
  | 'union'
  /** 只从云端拉取、从不推送（权限体系等以云端为准） */
  | 'remote-only'
  /** 只留本地、不参与同步（如高频计数器 ai_usage） */
  | 'local-only'
  /** 完全跳过（本地专用表：镜像/日志/冲突） */
  | 'skip';

/** 变更检测依据：优先时间戳；无时间戳时退化为内容哈希（无法判新旧，冲突时保守保留本地） */
export type ChangeBasis = 'updated_at' | 'hash';

/** 一行数据（宽进严出：DB 行的原始键值） */
export type SyncRow = Record<string, unknown>;

/** 表同步策略（注册表 src/sync/tables.ts 的项） */
export interface SyncPolicy {
  /** 表名 */
  table: string;
  /** 主键列（复合主键按声明顺序；行 id 由这些列的值拼接而成） */
  pk: string[];
  /** 同步角色 */
  role: SyncRole;
  /** 变更依据 */
  changeBy: ChangeBasis;
  /** 参与哈希与同步的列（省略 = 全部列） */
  columns?: string[];
  /**
   * 按行排除：返回 true 的行不参与同步。
   * 典型场景：settings 表是 KV，其中 `ai_usage` 是高频计数器，
   * 参与 LWW 会互相覆盖丢计数 → 排除，让它成为本地独立统计。
   */
  excludeWhere?: (row: SyncRow) => boolean;
  /** 备注（为何这样定策略，便于后人维护） */
  note?: string;
}

/** 一行在某一方（base/ours/theirs）的快照 */
export interface RowSnapshot {
  /** 行标识（复合主键用 '\u001f' 连接） */
  id: string;
  /** 内容哈希（见 core/hash.ts） */
  hash: string;
  /** 更新时间（ms epoch）；无时间戳列为 null */
  updatedAt: number | null;
  /** 原始行 */
  row: SyncRow;
}

/**
 * 同步操作（planTable 的产物）
 * - `pull-*`：把云端内容写到本地；`push-*`：把本地内容写到云端
 * - `conflict`：双方都改且无法自动裁决；`winner` 为胜方，败方整行由引擎备份到 sync_conflicts
 */
export type SyncOp =
  | { kind: 'pull-insert'; id: string; row: SyncRow }
  | { kind: 'pull-update'; id: string; row: SyncRow }
  | { kind: 'pull-delete'; id: string }
  | { kind: 'push-insert'; id: string; row: SyncRow }
  | { kind: 'push-update'; id: string; row: SyncRow }
  | { kind: 'push-delete'; id: string }
  | { kind: 'conflict'; id: string; local: SyncRow; remote: SyncRow; winner: 'local' | 'remote' };

/** 单表同步结果 */
export interface TableReport {
  table: string;
  /** 推送到云端的行数（insert+update） */
  pushed: number;
  /** 拉取到本地的行数（insert+update） */
  pulled: number;
  /** 在云端删除的行数 */
  deletedRemote: number;
  /** 在本地删除的行数 */
  deletedLocal: number;
  /** 冲突行数 */
  conflicts: number;
  /** 跳过原因（未配置/不可达/无镜像等） */
  skipped?: string;
  /** 耗时（ms） */
  timingMs: number;
}

/** 一次完整同步的报告 */
export interface SyncReport {
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  perTable: TableReport[];
  /** 全局警告（如「首次同步无镜像，删除不传播」） */
  warnings: string[];
}
