/**
 * 断路器（故障转移）单元测试
 *
 * 验证：
 * - 多端点优先级选择、失败标记下线、冷却后自愈回切、全线冷却时复位回退；
 * - guardThenable 对 thenable 的成功/失败/链式调用包裹正确，reject 恰好触发一次回调。
 */
import { describe, expect, it, vi } from 'vitest';
import { createCircuitBreaker, guardThenable } from '../db/breaker';

describe('circuit breaker', () => {
  it('单端点：markDown 为空操作，pick 始终返回 0', () => {
    const b = createCircuitBreaker(1);
    expect(b.size).toBe(1);
    expect(b.pick()).toBe(0);
    b.markDown(0);
    expect(b.pick()).toBe(0);
  });

  it('主库健康时走主库；主库下线后走备用库', () => {
    const b = createCircuitBreaker(2);
    expect(b.pick()).toBe(0);
    b.markDown(0);
    expect(b.pick()).toBe(1);
    // 备用库也下线：全线冷却 → 复位回退最高优先级
    b.markDown(1);
    expect(b.pick()).toBe(0);
  });

  it('冷却过期后自动回切主库（自愈）', () => {
    let t = 1000;
    const b = createCircuitBreaker(2, { cooldownMs: 5_000, now: () => t });
    expect(b.pick()).toBe(0);
    b.markDown(0);
    expect(b.pick()).toBe(1); // 主库冷却中
    // 未过冷却
    t += 4_000;
    expect(b.pick()).toBe(1);
    // 冷却过期
    t += 2_000;
    expect(b.pick()).toBe(0); // 自愈回切
    expect(b.__downUntil(0)).toBe(0);
  });

  it('仅当有多个端点时 markDown 才生效', () => {
    const b = createCircuitBreaker(3, { now: () => 0 });
    b.markDown(1);
    expect(b.pick()).toBe(0); // 0 仍健康，优先
    b.markDown(0);
    expect(b.pick()).toBe(2); // 0、1 下线 → 走 2
    expect(b.pick()).toBe(2);
  });
});

/** 构造一个模拟 postgres.js pending query 的 thenable 对象 */
function fakePending(opts: { then?: 'resolve' | 'reject'; thenPayload?: unknown; values?: 'resolve' | 'reject'; valuesPayload?: unknown }) {
  const thenP =
    opts.then === 'reject' ? Promise.reject(opts.thenPayload ?? new Error('then-reject')) : Promise.resolve(opts.thenPayload);
  const valuesP =
    opts.values === 'reject' ? Promise.reject(opts.valuesPayload ?? new Error('values-reject')) : Promise.resolve(opts.valuesPayload);
  thenP.catch(() => {}); // 抑制未处理 rejection
  valuesP.catch(() => {});
  return {
    then: (res: unknown, rej: unknown) => thenP.then(res as never, rej as never),
    values: () => valuesP,
  };
}

describe('guardThenable', () => {
  it('成功路径：值透传，不触发回调', async () => {
    const cb = vi.fn();
    const q = guardThenable(fakePending({ then: 'resolve', thenPayload: 7 }), cb);
    expect(await (q as unknown as Promise<number>)).toBe(7);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('失败路径：抛出原错误，触发一次回调', async () => {
    const cb = vi.fn();
    const q = guardThenable(fakePending({ then: 'reject', thenPayload: new Error('boom') }), cb);
    await expect(q as unknown as Promise<unknown>).rejects.toThrow('boom');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('链式 .values() 成功：值透传，不触发回调', async () => {
    const cb = vi.fn();
    const q = guardThenable(fakePending({ values: 'resolve', valuesPayload: [1, 2, 3] }), cb);
    const values = (q as unknown as { values: () => Promise<number[]> }).values();
    expect(await values).toEqual([1, 2, 3]);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('链式 .values() 失败：触发一次回调', async () => {
    const cb = vi.fn();
    const q = guardThenable(fakePending({ values: 'reject', valuesPayload: new Error('v-boom') }), cb);
    await expect((q as unknown as { values: () => Promise<unknown> }).values()).rejects.toThrow('v-boom');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('多次 then 仅触发一次回调', async () => {
    const cb = vi.fn();
    const q = guardThenable(fakePending({ then: 'reject', thenPayload: new Error('x') }), cb);
    await expect(q as unknown as Promise<unknown>).rejects.toThrow('x');
    await expect(q as unknown as Promise<unknown>).rejects.toThrow('x');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
