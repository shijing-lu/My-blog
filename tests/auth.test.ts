/**
 * 鉴权核心单元测试
 */
import { describe, expect, it } from 'vitest';
import { checkPassword, signSession, verifySessionToken } from '../src/lib/auth';

describe('auth', () => {
  it('会话令牌可正常验签', () => {
    const token = signSession();
    expect(verifySessionToken(token)).toBe(true);
  });

  it('篡改令牌被拒绝', () => {
    const token = signSession();
    const tampered = `${token.slice(0, -2)}xx`;
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it('空/非法令牌被拒绝', () => {
    expect(verifySessionToken('')).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken('abc')).toBe(false);
  });

  it('口令比对（timing-safe，读环境变量）', () => {
    process.env.ADMIN_PASSWORD = 'test-pass-123';
    expect(checkPassword('test-pass-123')).toBe(true);
    expect(checkPassword('nope')).toBe(false);
  });
});
