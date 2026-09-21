/**
 * 同步引擎核心单测：三方合并冲突矩阵 + 哈希稳定性
 *
 * 全部为纯函数测试（无 IO、无时钟依赖：时间由调用方显式给出），
 * 目的是把「谁新增 / 谁修改 / 谁删除 / 冲突怎么裁」的所有分支固定下来。
 */
import { describe, expect, it } from 'vitest';
import { planTable } from '../src/sync/core/diff';
import { rowHash, rowId, rowUpdatedAt } from '../src/sync/core/hash';
import type { RowSnapshot, SyncOp, SyncPolicy, SyncRole, SyncRow } from '../src/sync/core/types';

const PK = ['id'];

/** 构造策略 */
function policy(role: SyncRole, over: Partial<SyncPolicy> = {}): SyncPolicy {
  return { table: 'demo', pk: PK, role, changeBy: 'updated_at', ...over };
}

/** 构造快照（时间默认 1000ms，便于比较大小） */
function snap(row: SyncRow, updatedAt: number | null = 1000): RowSnapshot {
  return {
    id: rowId(row, PK),
    hash: rowHash(row),
    updatedAt,
    row,
  };
}

function map(...snaps: RowSnapshot[]): Map<string, RowSnapshot> {
  return new Map(snaps.map((s) => [s.id, s]));
}

function kinds(ops: SyncOp[]): string[] {
  return ops.map((o) => o.kind);
}

const OLD = { id: 'r1', title: '旧标题', updated_at: 1000 };
const LOCAL_NEW = { id: 'r1', title: '本地改的', updated_at: 2000 };
const REMOTE_NEW = { id: 'r1', title: '云端改的', updated_at: 3000 };

describe('sync core · 三方合并矩阵', () => {
  it('本地新增 → push-insert', () => {
    const ops = planTable(map(), map(snap(LOCAL_NEW)), map(), policy('lww'));
    expect(kinds(ops)).toEqual(['push-insert']);
  });

  it('云端新增 → pull-insert（首次全量拉取的普遍情形）', () => {
    const ops = planTable(map(), map(), map(snap(REMOTE_NEW)), policy('lww'));
    expect(kinds(ops)).toEqual(['pull-insert']);
  });

  it('本地删除且云端未变 → push-delete（删除传播）', () => {
    const ops = planTable(map(snap(OLD)), map(), map(snap(OLD)), policy('lww'));
    expect(kinds(ops)).toEqual(['push-delete']);
  });

  it('云端删除且本地未变 → pull-delete', () => {
    const ops = planTable(map(snap(OLD)), map(snap(OLD)), map(), policy('lww'));
    expect(kinds(ops)).toEqual(['pull-delete']);
  });

  it('两边都删 → 无操作（镜像由引擎清理）', () => {
    expect(planTable(map(snap(OLD)), map(), map(), policy('lww'))).toEqual([]);
  });

  it('双方都未变 → 无操作（幂等，重复同步零副作用）', () => {
    expect(planTable(map(snap(OLD)), map(snap(OLD)), map(snap(OLD)), policy('lww'))).toEqual([]);
  });

  it('仅本地改 → push-update', () => {
    const ops = planTable(map(snap(OLD)), map(snap(LOCAL_NEW, 2000)), map(snap(OLD)), policy('lww'));
    expect(kinds(ops)).toEqual(['push-update']);
  });

  it('仅云端改 → pull-update', () => {
    const ops = planTable(map(snap(OLD)), map(snap(OLD)), map(snap(REMOTE_NEW, 3000)), policy('lww'));
    expect(kinds(ops)).toEqual(['pull-update']);
  });

  it('双方都改 · 本地较新 → 冲突留痕且以本地为准', () => {
    const ops = planTable(map(snap(OLD)), map(snap(LOCAL_NEW, 2000)), map(snap(REMOTE_NEW, 1500)), policy('lww'));
    expect(kinds(ops)).toEqual(['conflict', 'push-update']);
    const c = ops[0] as Extract<SyncOp, { kind: 'conflict' }>;
    expect(c.winner).toBe('local');
    expect(c.remote).toMatchObject({ title: '云端改的' }); // 败方内容被保留，供备份
  });

  it('双方都改 · 云端较新 → 冲突留痕且以云端为准', () => {
    const ops = planTable(map(snap(OLD)), map(snap(LOCAL_NEW, 1200)), map(snap(REMOTE_NEW, 3000)), policy('lww'));
    expect(kinds(ops)).toEqual(['conflict', 'pull-update']);
    const c = ops[0] as Extract<SyncOp, { kind: 'conflict' }>;
    expect(c.winner).toBe('remote');
    expect(c.local).toMatchObject({ title: '本地改的' });
  });

  it('双方都改 · 时间戳相等或缺失 → 保守保留本地（不丢本地劳动成果）', () => {
    const ops = planTable(map(snap(OLD)), map(snap(LOCAL_NEW, null)), map(snap(REMOTE_NEW, null)), policy('lww'));
    const c = ops[0] as Extract<SyncOp, { kind: 'conflict' }>;
    expect(c.winner).toBe('local');
  });

  it('追加型表（union）双方都改 → 互不覆盖', () => {
    const ops = planTable(map(snap(OLD)), map(snap(LOCAL_NEW, 2000)), map(snap(REMOTE_NEW, 3000)), policy('union'));
    expect(ops).toEqual([]);
  });

  it('本地删 + 云端也改 → 复活云端内容并留痕（避免默默删掉云端新内容）', () => {
    const ops = planTable(map(snap(OLD)), map(), map(snap(REMOTE_NEW, 3000)), policy('lww'));
    expect(kinds(ops)).toEqual(['conflict', 'pull-update']);
  });

  it('云端删 + 本地改过 → 恢复本地内容并留痕', () => {
    const ops = planTable(map(snap(OLD)), map(snap(LOCAL_NEW, 2000)), map(), policy('lww'));
    expect(kinds(ops)).toEqual(['conflict', 'push-insert']);
  });

  it('remote-only 表：本地改了也要跟随云端（云端为准，本地留痕）', () => {
    const ops = planTable(map(snap(OLD)), map(snap(LOCAL_NEW, 2000)), map(snap(OLD)), policy('remote-only'));
    const c = ops[0] as Extract<SyncOp, { kind: 'conflict' }>;
    expect(c.winner).toBe('remote');
    expect(kinds(ops)).toEqual(['conflict', 'pull-update']);
  });

  it('local-only / skip 表 → 不产出任何操作', () => {
    const b = map(snap(OLD));
    expect(planTable(b, map(snap(LOCAL_NEW, 2000)), map(snap(REMOTE_NEW, 3000)), policy('local-only'))).toEqual([]);
    expect(planTable(b, map(snap(LOCAL_NEW, 2000)), map(snap(REMOTE_NEW, 3000)), policy('skip'))).toEqual([]);
  });
});

describe('sync core · 哈希与标识', () => {
  it('键顺序不影响哈希（不同驱动返回列顺序可能不同）', () => {
    expect(rowHash({ a: 1, b: 2 })).toBe(rowHash({ b: 2, a: 1 }));
  });

  it('Date / 数字时间戳 / 可解析字符串归一到同一哈希', () => {
    const base = rowHash({ t: 1700000000000 });
    expect(rowHash({ t: new Date(1700000000000) })).toBe(base);
    expect(rowHash({ t: '2023-11-14T22:13:20.000Z' })).toBe(base);
  });

  it('null 与 undefined 视为同一"空"值（避免误判为修改）', () => {
    expect(rowHash({ x: null })).toBe(rowHash({ x: undefined }));
  });

  it('布尔跨方言等价：PG 的 true/false ≡ SQLite 的 1/0（幂等关键，实测踩过坑）', () => {
    // 云 PG 布尔列读回 true/false，本地 SQLite 存 0/1；不归一 → 每次同步都误判"云端改了"
    expect(rowHash({ flag: true })).toBe(rowHash({ flag: 1 }));
    expect(rowHash({ flag: false })).toBe(rowHash({ flag: 0 }));
    expect(rowHash({ id: 'x', flag: false, title: 't' })).toBe(rowHash({ id: 'x', flag: 0, title: 't' }));
  });

  it('JSON 列跨方言等价：PG 的 jsonb（已解析）≡ SQLite 的 TEXT 字符串', () => {
    expect(rowHash({ tags: '["Markdown语法拓展"]' })).toBe(rowHash({ tags: ['Markdown语法拓展'] }));
    expect(rowHash({ meta: '{"a":1,"b":2}' })).toBe(rowHash({ meta: { a: 1, b: 2 } }));
    // 普通文本（不以 [ / { 开头）不会被误解析
    expect(rowHash({ title: '123' })).not.toBe(rowHash({ title: 123 }));
  });

  it('时间跨方言等价：Date（PG）/ 毫秒整数（SQLite）哈希一致', () => {
    const ms = 1731600000000;
    expect(rowHash({ updated_at: new Date(ms) })).toBe(rowHash({ updated_at: ms }));
  });

  it('内容不同则哈希不同（变更检测的基础）', () => {
    expect(rowHash({ title: 'a' })).not.toBe(rowHash({ title: 'b' }));
  });

  it('复合主键拼接为稳定行 id', () => {
    expect(rowId({ article_id: 'a1', category_id: 'c1' }, ['article_id', 'category_id'])).toBe('a1\u001fc1');
  });

  it('无时间戳列时 updatedAt 为 null（走 hash 兜底分支）', () => {
    expect(rowUpdatedAt({ id: 'x' })).toBeNull();
    expect(rowUpdatedAt({ updated_at: '2023-01-01T00:00:00Z' })).toBe(Date.parse('2023-01-01T00:00:00Z'));
  });
});
