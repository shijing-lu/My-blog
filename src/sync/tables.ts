/**
 * 同步表策略注册表（单一事实来源）
 *
 * ⚠️ 新增表/列时**必须**在这里登记，否则引擎会跳过它（并在日志里告警）。
 *    登记时需回答三个问题：谁可能改它？怎么判断改没改？两端冲突时听谁的？
 *
 * 角色语义：
 * - `lww`         站主内容，双方都可能改 → 按 updated_at 取新者，败方备份
 * - `union`       追加型（评论/点赞/浏览量/记录）→ 按主键并集补缺失，绝不覆盖
 * - `remote-only` 权限体系等以云端为准 → 只拉不推（本地若被改，用云端覆盖并留痕）
 * - `local-only`  只留本地 → 不参与同步（如高频计数器 ai_usage，避免 LWW 丢计数）
 * - `skip`        本地专用表（镜像/日志/冲突）→ 完全跳过
 */
import type { SyncPolicy, SyncRow } from './core/types';

/** 本地专用表（只存在于桌面端 SQLite，不参与同步） */
export const LOCAL_ONLY_TABLES = ['sync_mirror', 'sync_log', 'sync_conflicts'] as const;

/**
 * 30 张业务表的同步策略
 * 说明：union 表不需要 updated_at（按主键并集合并），lww 表必须有 updated_at
 *      —— D4-W1 已为 14 张 lww 表补齐该列。
 */
export const SYNC_POLICIES: SyncPolicy[] = [
  // ── 站主内容（LWW）─────────────────────────────────────────────────
  { table: 'articles', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '文章正文与元数据' },
  { table: 'diary_entries', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '日记' },
  { table: 'moments', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '动态' },
  { table: 'mindmaps', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '思维导图' },
  { table: 'study_tasks', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '学习任务' },
  { table: 'doc_articles', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '文档文章' },
  { table: 'doc_nodes', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '文档树节点（含内容）' },
  { table: 'doc_categories', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '文档分类' },
  { table: 'doc_bundles', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '文档册' },
  { table: 'photos', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '影集（对象体另走 R2 同步）' },
  { table: 'todos', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '待办' },
  { table: 'calendar_events', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '日历事件' },
  { table: 'comments', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '评论（访客新增为主，站主可改/审）' },
  { table: 'article_categories', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '文章分类' },
  {
    table: 'article_post_categories',
    pk: ['article_id'],
    role: 'lww',
    changeBy: 'updated_at',
    note: '文章归属分类（单分类语义：主键是 article_id）',
  },
  { table: 'web_categories', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '导航站分类' },
  { table: 'nav_sub_categories', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '导航站子分类' },
  { table: 'websites', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '导航站条目' },
  { table: 'checkin_tasks', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '打卡任务' },
  { table: 'github_users', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: 'GitHub 用户缓存' },
  { table: 'admin_applications', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: '管理员申请' },

  // ── 站点设置（key-value，特殊处理）───────────────────────────────────
  {
    table: 'settings',
    pk: ['key'],
    role: 'lww',
    changeBy: 'updated_at',
    note: '站点设置 KV；ai_usage 为高频计数器 → 排除（否则 LWW 会丢计数）',
    excludeWhere: (row: SyncRow) => row.key === 'ai_usage',
  },

  // ── 追加型（union，按主键并集）───────────────────────────────────────
  { table: 'images', pk: ['id'], role: 'union', changeBy: 'hash', note: '图片元数据（对象体另走 R2）' },
  { table: 'fonts', pk: ['id'], role: 'union', changeBy: 'hash', note: '字体（base64 内联，不涉 R2）' },
  { table: 'likes', pk: ['id'], role: 'union', changeBy: 'hash', note: '点赞（按指纹去重，删除=取消）' },
  { table: 'article_views', pk: ['id'], role: 'union', changeBy: 'hash', note: '阅读量记录' },
  { table: 'study_sessions', pk: ['id'], role: 'union', changeBy: 'hash', note: '番茄钟会话' },
  { table: 'study_distractions', pk: ['id'], role: 'union', changeBy: 'hash', note: '分心记录' },
  { table: 'checkin_records', pk: ['id'], role: 'union', changeBy: 'hash', note: '打卡记录' },

  // ── 云端为准 / 本地专用 ──────────────────────────────────────────────
  { table: 'admin_accounts', pk: ['id'], role: 'remote-only', changeBy: 'updated_at', note: '权限体系以云端为准，只拉不推' },
  // ── AI 小卿（站主私有数据；仅站主会改，LWW 足够）─────────────────────
  { table: 'ai_conversations', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: 'AI 会话（站主专属；游客不落库）' },
  { table: 'ai_messages', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: 'AI 消息原文（只新增，不改写）' },
  { table: 'ai_memories', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: 'AI 长期记忆条目（站主可编辑/删除）' },
  { table: 'ai_bond', pk: ['id'], role: 'lww', changeBy: 'updated_at', note: 'AI 养成度单行聚合（id=owner）' },
  ...LOCAL_ONLY_TABLES.map((table) => ({ table, pk: ['id'], role: 'skip' as const, changeBy: 'hash' as const })),
];

/** 取某表的策略；未登记返回 undefined（调用方应视为"漂移"并告警） */
export function policyFor(table: string): SyncPolicy | undefined {
  return SYNC_POLICIES.find((p) => p.table === table);
}

/**
 * 找出「业务表里有、但注册表里没有」的表 —— 防止新表忘记登记导致静默不参与同步。
 * @param allTables 数据库里的全部表名（不含本地专用表）
 */
export function tablesMissingPolicy(allTables: string[]): string[] {
  const known = new Set(SYNC_POLICIES.map((p) => p.table));
  return allTables.filter((t) => !known.has(t) && !LOCAL_ONLY_TABLES.includes(t as never));
}
