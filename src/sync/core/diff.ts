/**
 * 三方键集合并（Git 式）：planTable(base, ours, theirs) → 操作计划
 *
 * ## 为什么是"三方"
 * 两方对比只能看出"不一样"，看不出"谁改的、谁删的"。有了 base（上次同步的镜像快照）
 * 才能区分：
 *   - base 有、本地没有、云端没变 → **本地删除**（要传播到云端）
 *   - base 有、云端没有、本地没变 → **云端删除**（要传播到本地）
 *   - base 有、两边都没变       → 无操作（幂等，重复同步零副作用）
 *
 * ## 冲突处理原则
 * 只要**两边都动过**同一行，就记为 conflict（败方整行备份，交由引擎写 sync_conflicts），
 * 哪怕能靠 LWW 裁决——因为"能裁决"不等于"用户期望如此"，留痕才不丢数据。
 *
 * ⚠️ 本文件是纯函数：不碰数据库、不碰网络、不读时钟（时间来自快照），
 *    因此冲突矩阵可以被单测完整覆盖（tests/sync-core.test.ts）。
 */
import type { RowSnapshot, SyncOp, SyncPolicy, SyncRow } from './types';

/** 取快照；缺失返回 undefined */
type SnapMap = Map<string, RowSnapshot>;

/** 该行相对于 base 是否被改动过（base 缺失即视为"新增"） */
function changed(snap: RowSnapshot | undefined, base: RowSnapshot | undefined): boolean {
  if (!base) return true;
  if (!snap) return false; // 不存在（删除）不叫"改动"，由删除分支单独处理
  return snap.hash !== base.hash;
}

/** LWW 裁决：返回胜方；时间相同/缺失时保守保留本地（不丢本地劳动成果） */
function pickWinner(ours: RowSnapshot, theirs: RowSnapshot): 'local' | 'remote' {
  if (ours.updatedAt === null && theirs.updatedAt === null) return 'local';
  if (ours.updatedAt === null) return 'remote';
  if (theirs.updatedAt === null) return 'local';
  if (ours.updatedAt === theirs.updatedAt) return 'local';
  return ours.updatedAt > theirs.updatedAt ? 'local' : 'remote';
}

/** 远端为准（remote-only）时，本地若有改动也要用云端覆盖，并备份本地 */
function pullWithConflict(
  id: string,
  local: SyncRow,
  remote: SyncRow,
  winner: 'local' | 'remote',
): SyncOp[] {
  return [
    { kind: 'conflict', id, local, remote, winner },
    winner === 'remote' ? { kind: 'pull-update', id, row: remote } : { kind: 'push-update', id, row: local },
  ];
}

/**
 * 计算一张表的同步操作计划。
 *
 * @param base   上次同步镜像（Map<行 id, 快照>）；首次同步为空 Map（此时删除不传播）
 * @param ours   本地当前行集
 * @param theirs 云端当前行集
 * @param policy 表策略（角色 / 主键 / 变更依据）
 */
export function planTable(base: SnapMap, ours: SnapMap, theirs: SnapMap, policy: SyncPolicy): SyncOp[] {
  const ops: SyncOp[] = [];
  if (policy.role === 'skip' || policy.role === 'local-only') return ops;

  const ids = new Set<string>([...base.keys(), ...ours.keys(), ...theirs.keys()]);

  for (const id of ids) {
    const b = base.get(id);
    const o = ours.get(id);
    const t = theirs.get(id);
    const oursChanged = changed(o, b);
    const theirsChanged = changed(t, b);

    // ── ① base 没有：全新行 ────────────────────────────────────────────
    if (!b) {
      if (o && !t) {
        ops.push({ kind: 'push-insert', id, row: o.row });
      } else if (!o && t) {
        ops.push({ kind: 'pull-insert', id, row: t.row });
      } else if (o && t) {
        // 两边各自新建了同一主键（UUID 场景极罕见）：保留本地 + 留痕
        if (o.hash !== t.hash) {
          const winner = pickWinner(o, t);
          ops.push(...pullWithConflict(id, o.row, t.row, winner));
        }
      }
      continue;
    }

    // ── ② 两边都删了：清理镜像即可，无需操作 ────────────────────────────
    if (!o && !t) continue;

    // ── ③ 本地删了 ────────────────────────────────────────────────────
    if (!o && t) {
      if (!theirsChanged) {
        ops.push({ kind: 'push-delete', id }); // 云端没动 → 确认是本地删除，传播
      } else {
        // 云端也改了：远端更新的内容更"有价值"，复活并留痕（避免默默删掉云端新内容）
        ops.push({ kind: 'conflict', id, local: {}, remote: t.row, winner: 'remote' });
        ops.push({ kind: 'pull-update', id, row: t.row });
      }
      continue;
    }

    // ── ④ 云端删了 ────────────────────────────────────────────────────
    if (o && !t) {
      if (!oursChanged) {
        ops.push({ kind: 'pull-delete', id }); // 本地没动 → 确认是云端删除，传播
      } else if (policy.role === 'remote-only') {
        // 云端为准：即使本地改过也跟随云端删除，但备份本地
        ops.push({ kind: 'conflict', id, local: o.row, remote: {}, winner: 'remote' });
        ops.push({ kind: 'pull-delete', id });
      } else {
        // 本地还改过 → 保守恢复本地内容（不丢用户劳动成果）并留痕
        ops.push({ kind: 'conflict', id, local: o.row, remote: {}, winner: 'local' });
        ops.push({ kind: 'push-insert', id, row: o.row });
      }
      continue;
    }

    // ── ⑤ 两边都还在：比较是否被改动 ────────────────────────────────────
    const localRow = o!.row;
    const remoteRow = t!.row;

    if (!oursChanged && !theirsChanged) continue; // 幂等：无操作
    if (!oursChanged && theirsChanged) {
      ops.push({ kind: 'pull-update', id, row: remoteRow });
      continue;
    }
    if (oursChanged && !theirsChanged) {
      if (policy.role === 'remote-only') {
        // 云端为准：用云端内容覆盖本地，备份本地
        ops.push(...pullWithConflict(id, localRow, remoteRow, 'remote'));
      } else {
        ops.push({ kind: 'push-update', id, row: localRow });
      }
      continue;
    }

    // 双方都改过
    if (policy.role === 'union') {
      // 追加型：两边都只是"各自新增/追加"，不互相覆盖（避免把对方内容盖掉）
      continue;
    }
    const winner = policy.role === 'remote-only' ? 'remote' : pickWinner(o!, t!);
    ops.push(...pullWithConflict(id, localRow, remoteRow, winner));
  }

  return ops;
}

/** 由行集构建快照 Map（供适配器调用） */
export function buildSnapshots(
  rows: SyncRow[],
  resolve: { id: (row: SyncRow) => string; hash: (row: SyncRow) => string; updatedAt: (row: SyncRow) => number | null },
): SnapMap {
  const map: SnapMap = new Map();
  for (const row of rows) {
    map.set(resolve.id(row), { id: resolve.id(row), hash: resolve.hash(row), updatedAt: resolve.updatedAt(row), row });
  }
  return map;
}
