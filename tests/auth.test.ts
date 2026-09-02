/**
 * 鉴权核心单元测试
 */
import { describe, expect, it } from 'vitest';
import { checkPassword, safeNextPath, signSession, verifySessionToken } from '../src/lib/auth';

// 会话签名密钥是硬校验项（AUTH_SECRET 缺失时 auth.ts 会抛错，不再回退到 ADMIN_PASSWORD 派生）。
// vitest 不加载项目 .env，这里显式注入测试用密钥。
process.env.AUTH_SECRET ||= 'test-auth-secret-for-vitest';

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

describe('safeNextPath（防开放重定向）', () => {
  const FALLBACK = '/moments';

  it('放行站内正常路径', () => {
    expect(safeNextPath('/blog/abc')).toBe('/blog/abc');
    expect(safeNextPath('/moments?page=2#top')).toBe('/moments?page=2#top');
    expect(safeNextPath('/')).toBe('/');
  });

  it('空值回落到默认路径', () => {
    expect(safeNextPath(null)).toBe(FALLBACK);
    expect(safeNextPath(undefined)).toBe(FALLBACK);
    expect(safeNextPath('')).toBe(FALLBACK);
  });

  it('拦截协议相对 URL', () => {
    expect(safeNextPath('//evil.com')).toBe(FALLBACK);
    expect(safeNextPath('//evil.com/x')).toBe(FALLBACK);
  });

  it('拦截反斜杠绕过（浏览器会把 \\ 规范化为 /）', () => {
    expect(safeNextPath('/\\evil.com')).toBe(FALLBACK);
    expect(safeNextPath('\\evil.com')).toBe(FALLBACK);
    expect(safeNextPath('/\\/evil.com')).toBe(FALLBACK);
    expect(safeNextPath('/moments\\@evil.com')).toBe(FALLBACK);
  });

  it('拦截绝对 URL 与其它 scheme', () => {
    expect(safeNextPath('https://evil.com')).toBe(FALLBACK);
    expect(safeNextPath('http:/evil.com')).toBe(FALLBACK);
    expect(safeNextPath('javascript:alert(1)')).toBe(FALLBACK);
  });

  it('拦截控制字符（防 Location 头注入）', () => {
    expect(safeNextPath('/moments\r\nSet-Cookie: a=1')).toBe(FALLBACK);
    expect(safeNextPath('/mo\nments')).toBe(FALLBACK);
    expect(safeNextPath('/moments\u0000')).toBe(FALLBACK);
  });
});
