import { describe, expect, it } from 'vitest';
import { motionMilliseconds } from '../src/lib/motion';

describe('构建后 CSS 时间令牌到 WAAPI 毫秒', () => {
  it('开发与压缩后单位得到相同时长', () => {
    expect(motionMilliseconds('240ms')).toBe(240);
    expect(motionMilliseconds(' .24s ')).toBe(240);
    expect(motionMilliseconds('0ms')).toBe(0);
  });
  it('无效值回退，超长值限制到一秒', () => {
    for (const value of ['', 'NaN', '-1s', 'var(--missing)', '12garbage']) expect(motionMilliseconds(value)).toBe(160);
    expect(motionMilliseconds('120s')).toBe(1000);
  });
});
