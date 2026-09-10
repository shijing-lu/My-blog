/**
 * 文章访问密码（服务端拦截）测试
 *
 * 覆盖：
 * - 密码哈希往返：正确密码通过、错误密码拒绝
 * - 密码不做长度下限限制（含 1 位）
 * - 空密码 / 超长密码拒绝
 * - 哈希不可逆（落库内容不含明文）
 * - 旧「全文加密」格式被识别为无法校验（需站主重设密码）
 * - 解锁 Cookie 名按文章隔离
 * - 时长常量合理性
 */
import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  parsePasswordHash,
  verifyPassword,
  assertPasswordStrength,
  ArticlePasswordError,
  unlockCookieName,
  MAX_PASSWORD_LENGTH,
} from '../src/lib/article-password';
import { SIGNED_TTL_PERMANENT_MS } from '../src/lib/auth';

describe('文章访问密码：哈希与校验', () => {
  const PASSWORD = 'my-blog-gate-2026';

  it('正确密码通过校验', () => {
    const meta = hashPassword(PASSWORD);
    expect(verifyPassword(PASSWORD, meta)).toBe(true);
  });

  it('错误密码被拒绝', () => {
    const meta = hashPassword(PASSWORD);
    expect(verifyPassword('wrong-password', meta)).toBe(false);
    expect(verifyPassword(PASSWORD + 'x', meta)).toBe(false);
    expect(verifyPassword('', meta)).toBe(false);
  });

  it('落库内容不含密码明文', () => {
    const meta = hashPassword(PASSWORD);
    const raw = JSON.stringify(meta);
    expect(raw).not.toContain(PASSWORD);
    // 也不含明文的其他形式
    expect(raw).not.toContain(Buffer.from(PASSWORD).toString('base64'));
  });

  it('相同密码每次哈希不同（随机盐）', () => {
    const a = hashPassword(PASSWORD);
    const b = hashPassword(PASSWORD);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // 但都可校验通过
    expect(verifyPassword(PASSWORD, a)).toBe(true);
    expect(verifyPassword(PASSWORD, b)).toBe(true);
  });

  it('哈希往返：序列化 → 解析 → 校验一致', () => {
    const meta = hashPassword(PASSWORD);
    const parsed = parsePasswordHash(JSON.stringify(meta));
    expect(parsed).not.toBeNull();
    expect(verifyPassword(PASSWORD, parsed!)).toBe(true);
    expect(verifyPassword('nope', parsed!)).toBe(false);
  });

  it('密码不做长度下限限制（1 位数字也允许）', () => {
    for (const pwd of ['1', '12', '123', 'a']) {
      expect(() => assertPasswordStrength(pwd)).not.toThrow();
      const meta = hashPassword(pwd);
      expect(verifyPassword(pwd, meta)).toBe(true);
    }
  });

  it('空密码被拒绝', () => {
    expect(() => assertPasswordStrength('')).toThrow(ArticlePasswordError);
    expect(() => hashPassword('')).toThrow(/请设置/);
  });

  it('超长密码被拒绝', () => {
    expect(() => assertPasswordStrength('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toThrow(/最长/);
  });

  it('中文与 emoji 密码可用', () => {
    const pwd = '密码🎉测试';
    const meta = hashPassword(pwd);
    expect(verifyPassword(pwd, meta)).toBe(true);
    expect(verifyPassword('密码🎉测', meta)).toBe(false);
  });
});

describe('密码哈希解析的健壮性', () => {
  it('空值 → null', () => {
    expect(parsePasswordHash('')).toBeNull();
    expect(parsePasswordHash(null)).toBeNull();
    expect(parsePasswordHash(undefined)).toBeNull();
  });

  it('非法 JSON → null（不抛错）', () => {
    expect(parsePasswordHash('{不是合法 JSON')).toBeNull();
  });

  it('缺字段 → null', () => {
    expect(parsePasswordHash(JSON.stringify({ v: 1, algo: 'PBKDF2-SHA256' }))).toBeNull();
    expect(
      parsePasswordHash(JSON.stringify({ v: 1, algo: 'PBKDF2-SHA256', salt: 'abc' })),
    ).toBeNull();
  });

  it('版本不符 → null', () => {
    expect(
      parsePasswordHash(JSON.stringify({ v: 99, algo: 'PBKDF2-SHA256', salt: 'a', hash: 'b' })),
    ).toBeNull();
  });

  it('旧的「全文加密」格式（含 ct 字段）→ null（视作需重设密码）', () => {
    const oldFormat = JSON.stringify({
      v: 1,
      algo: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 250000,
      salt: 'abc',
      iv: 'def',
      ct: 'ghi',
    });
    expect(parsePasswordHash(oldFormat)).toBeNull();
  });
});

describe('解锁 Cookie 与时长', () => {
  it('Cookie 名按文章 id 隔离且长度稳定', () => {
    const a = unlockCookieName('article-a');
    const b = unlockCookieName('article-b');
    expect(a).not.toBe(b);
    expect(a.startsWith('article_unlock_')).toBe(true);
    // uuid 与 slug 形态应产出等长 Cookie 名
    const uuidName = unlockCookieName('f6f39ebd-7882-4b24-8e90-05281d4705c6');
    const slugName = unlockCookieName('my-article-slug');
    expect(uuidName.length).toBe(slugName.length);
  });

  it('同一 id 稳定产出同一 Cookie 名', () => {
    expect(unlockCookieName('same-id')).toBe(unlockCookieName('same-id'));
  });

  it('「永久有效」为 10 年量级（避免无限期令牌无法自然过期）', () => {
    const tenYears = 10 * 365 * 24 * 60 * 60 * 1000;
    expect(SIGNED_TTL_PERMANENT_MS).toBe(tenYears);
  });
});
