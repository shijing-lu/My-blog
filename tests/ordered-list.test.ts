/**
 * ordered-list 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * 这些纯函数是「就地更新、不整页刷新」的正确性基石：客户端在内存里插一条新记录时，
 * 位置必须和服务端 `ORDER BY sort ASC, createdAt ASC` 的输出完全一致 ——
 * 否则用户会看到条目在下次刷新后莫名跳位。
 *
 * 因此这里重点锁住三件事：
 * 1. `comesBefore` 与服务端排序语义等价（sort 优先，createdAt 次之）；
 * 2. `createdAt` 的两种形态（服务端 Date / 客户端 ISO 字符串）比较结果一致；
 * 3. 只移动被操作的那一项，其余元素相对顺序不变。
 */
import { describe, it, expect } from 'vitest';
import { comesBefore, insertOrdered, removeById } from '../src/lib/ordered-list';
import type { Sortable } from '../src/lib/ordered-list';

interface Row extends Sortable {
  id: string;
}

const row = (id: string, sort: number, createdAt: string | Date): Row => ({ id, sort, createdAt });

describe('comesBefore', () => {
  it('sort 小的排前面（sort 优先于 createdAt）', () => {
    expect(comesBefore(row('a', 0, '2026-05-01T00:00:00.000Z'), row('b', 1, '2026-01-01T00:00:00.000Z'))).toBe(true);
    expect(comesBefore(row('b', 1, '2026-01-01T00:00:00.000Z'), row('a', 0, '2026-05-01T00:00:00.000Z'))).toBe(false);
  });

  it('sort 相同则 createdAt 早的排前面', () => {
    expect(comesBefore(row('a', 0, '2026-01-01T00:00:00.000Z'), row('b', 0, '2026-01-02T00:00:00.000Z'))).toBe(true);
    expect(comesBefore(row('b', 0, '2026-01-02T00:00:00.000Z'), row('a', 0, '2026-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('sort 与 createdAt 都相同 → 不算在前（保证稳定，不产生无意义的提前）', () => {
    const t = '2026-01-01T00:00:00.000Z';
    expect(comesBefore(row('a', 3, t), row('b', 3, t))).toBe(false);
  });

  it('createdAt 的 Date 与 ISO 字符串两种形态比较结果一致', () => {
    const early = row('a', 0, new Date('2026-01-01T00:00:00.000Z'));
    const late = row('b', 0, '2026-01-02T00:00:00.000Z');
    expect(comesBefore(early, late)).toBe(true);
    expect(comesBefore(late, early)).toBe(false);
    // 反向：Date 在后、字符串在前
    expect(comesBefore(row('c', 0, '2026-01-03T00:00:00.000Z'), row('d', 0, new Date('2026-01-04T00:00:00.000Z')))).toBe(true);
  });

  it('createdAt 无法解析时按 0 处理（排最前），不会抛异常', () => {
    expect(comesBefore(row('a', 0, 'not-a-date'), row('b', 0, '2026-01-01T00:00:00.000Z'))).toBe(true);
  });
});

describe('insertOrdered', () => {
  it('空列表直接放入', () => {
    const list: Row[] = [];
    insertOrdered(list, row('a', 0, '2026-01-01T00:00:00.000Z'));
    expect(list.map((x) => x.id)).toEqual(['a']);
  });

  it('新建（createdAt 最大）落在同 sort 组末尾', () => {
    const list = [row('a', 0, '2026-01-01T00:00:00.000Z'), row('b', 0, '2026-01-02T00:00:00.000Z')];
    insertOrdered(list, row('n', 0, '2026-01-03T00:00:00.000Z'));
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'n']);
  });

  it('sort 更大的新建项插到组后面（跨 sort 边界）', () => {
    const list = [row('a', 0, '2026-01-01T00:00:00.000Z'), row('b', 0, '2026-01-02T00:00:00.000Z')];
    insertOrdered(list, row('n', 1, '2026-01-03T00:00:00.000Z'));
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'n']);
  });

  it('sort 更小的新建项插到最前', () => {
    const list = [row('a', 5, '2026-01-01T00:00:00.000Z'), row('b', 9, '2026-01-02T00:00:00.000Z')];
    insertOrdered(list, row('n', 1, '2026-01-03T00:00:00.000Z'));
    expect(list.map((x) => x.id)).toEqual(['n', 'a', 'b']);
  });

  it('sort 相同时按 createdAt 插到中间（不是无脑追加）', () => {
    const list = [row('a', 0, '2026-01-01T00:00:00.000Z'), row('c', 0, '2026-01-03T00:00:00.000Z')];
    insertOrdered(list, row('b', 0, '2026-01-02T00:00:00.000Z'));
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('编辑（removeById + insertOrdered）保持原位，且不扰动其他项', () => {
    const list = [
      row('a', 0, '2026-01-01T00:00:00.000Z'),
      row('b', 0, '2026-01-02T00:00:00.000Z'),
      row('c', 1, '2026-01-03T00:00:00.000Z'),
    ];
    const moved = removeById(list, 'b')!;
    insertOrdered(list, moved);
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('改变 sort 后重排到新位置（其余项相对顺序不变）', () => {
    const list = [
      row('a', 0, '2026-01-01T00:00:00.000Z'),
      row('b', 0, '2026-01-02T00:00:00.000Z'),
      row('c', 1, '2026-01-03T00:00:00.000Z'),
    ];
    const moved = removeById(list, 'a')!;
    moved.sort = 2;
    insertOrdered(list, moved);
    expect(list.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('结果与「按 comesBefore 排序」等价（顺序不变量）', () => {
    const base: Row[] = [];
    const inputs = [
      row('a', 1, '2026-01-05T00:00:00.000Z'),
      row('b', 0, '2026-01-09T00:00:00.000Z'),
      row('c', 1, '2026-01-02T00:00:00.000Z'),
      row('d', 0, '2026-01-01T00:00:00.000Z'),
      row('e', 2, '2026-01-03T00:00:00.000Z'),
    ];
    for (const it of inputs) insertOrdered(base, it);
    const sorted = [...inputs].sort((x, y) => (comesBefore(x, y) ? -1 : comesBefore(y, x) ? 1 : 0));
    expect(base.map((x) => x.id)).toEqual(sorted.map((x) => x.id));
  });

  it('原地修改传入数组（返回 void，调用方直接复用引用）', () => {
    const list = [row('a', 0, '2026-01-01T00:00:00.000Z')];
    const ret = insertOrdered(list, row('b', 0, '2026-01-02T00:00:00.000Z'));
    expect(ret).toBeUndefined();
    expect(list).toHaveLength(2);
  });
});

describe('removeById', () => {
  it('移除并返回命中项', () => {
    const list = [row('a', 0, '2026-01-01T00:00:00.000Z'), row('b', 0, '2026-01-02T00:00:00.000Z')];
    const got = removeById(list, 'a');
    expect(got?.id).toBe('a');
    expect(list.map((x) => x.id)).toEqual(['b']);
  });

  it('未命中时返回 undefined 且不改动数组', () => {
    const list = [row('a', 0, '2026-01-01T00:00:00.000Z')];
    expect(removeById(list, 'zzz')).toBeUndefined();
    expect(list.map((x) => x.id)).toEqual(['a']);
  });

  it('重复 id 时只移除第一个', () => {
    const list = [row('a', 0, '2026-01-01T00:00:00.000Z'), row('a', 0, '2026-01-02T00:00:00.000Z')];
    removeById(list, 'a');
    expect(list).toHaveLength(1);
    expect(list[0]!.createdAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
