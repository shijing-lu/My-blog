/**
 * AI 小卿：养成度（bond）纯函数测试
 *
 * 覆盖：等级派生阈值、权重归一化、日切与连续天、深度分上限、只升不降。
 */
import { describe, expect, it } from 'vitest';
import {
  defaultBondRow,
  deriveLevel,
  familiarityOf,
  levelBehaviorText,
  messageDepthScore,
  updateBondOnMessage,
} from '../src/lib/ai-bond';

describe('deriveLevel 等级派生', () => {
  it('阈值边界正确（0/30/80/160/280/450/680/950 → L0~L7）', () => {
    const thresholds = [0, 30, 80, 160, 280, 450, 680, 950];
    thresholds.forEach((t, i) => expect(deriveLevel(t)).toBe(i));
    // 恰好在阈值之下的值
    expect(deriveLevel(29)).toBe(0);
    expect(deriveLevel(79)).toBe(1);
    expect(deriveLevel(159)).toBe(2);
    expect(deriveLevel(949)).toBe(6);
    // 超过最高阈值
    expect(deriveLevel(2000)).toBe(7);
  });

  it('负数回退为 L0', () => {
    expect(deriveLevel(-1)).toBe(0);
  });
});

describe('messageDepthScore 深度分', () => {
  it('空内容得 0 分', () => {
    expect(messageDepthScore('')).toBe(0);
  });
  it('短内容分数低', () => {
    expect(messageDepthScore('好')).toBeLessThan(10);
  });
  it('长内容分数高但有上限 50', () => {
    // √625×2 = 50 恰好触顶；1000 字必封顶
    expect(messageDepthScore('长'.repeat(1000))).toBe(50);
    expect(messageDepthScore('长'.repeat(500))).toBe(45); // √500×2 ≈ 44.7
  });
  it('√曲线：等加法步长下增量递减（凹函数）', () => {
    const s100 = messageDepthScore('a'.repeat(100));
    const s200 = messageDepthScore('a'.repeat(200));
    const s300 = messageDepthScore('a'.repeat(300));
    // 100→200 的增量 > 200→300 的增量（√ 凹函数压缩）
    expect(s200 - s100).toBeGreaterThan(s300 - s200);
  });
});

describe('updateBondOnMessage 养成更新', () => {
  it('首次消息：新的一天 → activeDays=1, streakDays=1', () => {
    const bond = updateBondOnMessage(defaultBondRow(), '你好');
    expect(bond.messageCount).toBe(1);
    expect(bond.activeDays).toBe(1);
    expect(bond.streakDays).toBe(1);
    expect(bond.depthScore).toBeGreaterThan(0);
  });

  it('同一天多条消息：activeDays/streakDays 不重复累加', () => {
    const today = new Date().toISOString().slice(0, 10);
    const base = { ...defaultBondRow(), lastActiveDate: today, messageCount: 5, activeDays: 3, streakDays: 2 };
    const updated = updateBondOnMessage(base, '继续聊');
    expect(updated.messageCount).toBe(6);
    expect(updated.activeDays).toBe(3); // 不变
    expect(updated.streakDays).toBe(2); // 不变
  });

  it('连续天：昨天活跃 → streak+1', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const base = { ...defaultBondRow(), lastActiveDate: yesterday, activeDays: 3, streakDays: 2 };
    const updated = updateBondOnMessage(base, '新的一天');
    expect(updated.streakDays).toBe(3);
    expect(updated.activeDays).toBe(4);
  });

  it('断签：隔了两天 → streak 清零重计', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const base = { ...defaultBondRow(), lastActiveDate: twoDaysAgo, streakDays: 5, activeDays: 10 };
    const updated = updateBondOnMessage(base, '回来了');
    expect(updated.streakDays).toBe(1);
    expect(updated.activeDays).toBe(11);
  });

  it('等级只升不降：已有 level=3 时即使 bondPoints 停滞也不掉级', () => {
    const base = { ...defaultBondRow(), level: 3, bondPoints: 200 };
    const updated = updateBondOnMessage(base, '继续');
    expect(updated.level).toBeGreaterThanOrEqual(3);
  });

  it('bondPoints 单调递增（每次消息都在累加）', () => {
    let bond = defaultBondRow();
    const before = bond.bondPoints;
    bond = updateBondOnMessage(bond, '第一条消息，内容较长一些以获得深度分');
    expect(bond.bondPoints).toBeGreaterThan(before);
  });

  it('深度分对数压缩：500 字与 5000 字的差距远小于 10 倍', () => {
    const s500 = messageDepthScore('a'.repeat(500));
    const s5000 = messageDepthScore('a'.repeat(5000));
    // 10 倍的内容 → 不到 2.2 倍的分数（√压缩）
    expect(s5000 / s500).toBeLessThan(2.2);
  });
});

describe('familiarityOf 亲密度', () => {
  it('bondPoints=0 → 0', () => {
    expect(familiarityOf(defaultBondRow())).toBe(0);
  });
  it('bondPoints=1000 → 1', () => {
    expect(familiarityOf({ ...defaultBondRow(), bondPoints: 1000 })).toBe(1);
  });
  it('超出 1000 → 钳位为 1', () => {
    expect(familiarityOf({ ...defaultBondRow(), bondPoints: 2000 })).toBe(1);
  });
});

describe('levelBehaviorText 行为约束', () => {
  it('每个等级都有约束文本', () => {
    for (let i = 0; i <= 7; i += 1) {
      expect(levelBehaviorText(i).length).toBeGreaterThan(0);
    }
  });
  it('超出范围的等级钳位到最高级 L7（负数才回退 L0）', () => {
    expect(levelBehaviorText(99)).toBe(levelBehaviorText(7));
    expect(levelBehaviorText(-1)).toBe(levelBehaviorText(0));
  });
});
