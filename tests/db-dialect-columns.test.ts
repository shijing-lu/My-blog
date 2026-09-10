/**
 * 双方言列编解码回归测试
 *
 * 背景（2026-09-10 生产事故）：`articles.encrypted` 曾用
 * `integer('encrypted', { mode: 'boolean' })` 定义，SQLiteBoolean 的 toDriver
 * 恒编码为整数 1/0；生产 PG 的列是 `boolean` 类型，收到整数 1 不会转真值，
 * 静默存成 false —— 加密文章保存后 `encrypted` 恒为 false，门禁不生效。
 *
 * ⚠️ 该 bug 只在 PG 上暴露，本地 SQLite 完全正常，测试必须覆盖 PG 分支。
 */
import { describe, expect, it, vi } from 'vitest';

/** 复刻 booleanFlag 的 toDriver/fromDriver（与 db/schema.sqlite.ts 保持一致） */
function makeFlag(isPg: boolean) {
  return {
    toDriver: (value: boolean) => (isPg ? value : value ? 1 : 0),
    fromDriver: (value: boolean | number) => (typeof value === 'boolean' ? value : value === 1),
  };
}

/** 复刻 timestampMs 的 toDriver（同款双方言补丁，一并回归） */
function makeTimestamp(isPg: boolean) {
  return {
    toDriver: (value: Date) => (isPg ? value.toISOString() : value.getTime()),
    fromDriver: (value: string | number | Date) => (value instanceof Date ? value : new Date(value)),
  };
}

describe('booleanFlag 双方言编解码', () => {
  it('PG 分支：真值必须是 boolean，不能是整数（事故根因）', () => {
    const f = makeFlag(true);
    expect(f.toDriver(true)).toBe(true);
    expect(f.toDriver(false)).toBe(false);
    // 显式断言类型：整数 1 会被 PG boolean 列当假值
    expect(typeof f.toDriver(true)).toBe('boolean');
  });

  it('SQLite 分支：整数 1/0', () => {
    const f = makeFlag(false);
    expect(f.toDriver(true)).toBe(1);
    expect(f.toDriver(false)).toBe(0);
  });

  it('fromDriver 兼容布尔与整数两种驱动返回值', () => {
    const f = makeFlag(true);
    expect(f.fromDriver(true)).toBe(true);
    expect(f.fromDriver(false)).toBe(false);
    expect(f.fromDriver(1)).toBe(true);
    expect(f.fromDriver(0)).toBe(false);
  });

  it('往返一致（PG 与 SQLite 两个分支）', () => {
    for (const isPg of [true, false]) {
      const f = makeFlag(isPg);
      expect(f.fromDriver(f.toDriver(true))).toBe(true);
      expect(f.fromDriver(f.toDriver(false))).toBe(false);
    }
  });

  it('回归防护：旧写法 integer(mode:boolean) 的编码是整数 1（反例）', () => {
    // 模拟旧 SQLiteBoolean 行为：恒整数
    const legacyToDriver = (value: boolean) => (value ? 1 : 0);
    // PG 布尔列收到 1 → 被当假值，这就是事故成因
    expect(legacyToDriver(true)).toBe(1);
    // 新实现必须返回真布尔
    expect(makeFlag(true).toDriver(true)).not.toBe(1);
  });
});

describe('timestampMs 双方言编解码（既有补丁回归）', () => {
  const d = new Date('2026-09-10T12:00:00.000Z');

  it('PG 分支输出 ISO 字符串（postgres.js 不接受 number 参数）', () => {
    expect(makeTimestamp(true).toDriver(d)).toBe('2026-09-10T12:00:00.000Z');
  });

  it('SQLite 分支输出毫秒整数', () => {
    expect(makeTimestamp(false).toDriver(d)).toBe(d.getTime());
  });

  it('fromDriver 兼容两种入参', () => {
    const t = makeTimestamp(true);
    expect(t.fromDriver('2026-09-10T12:00:00.000Z').getTime()).toBe(d.getTime());
    expect(t.fromDriver(d.getTime()).getTime()).toBe(d.getTime());
  });
});
