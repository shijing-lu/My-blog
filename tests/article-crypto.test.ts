/**
 * 文章加密测试
 *
 * 覆盖：
 * - 加解密往返（含中文 / emoji / 大文本）
 * - 密码错误必须失败（AES-GCM 认证）
 * - 密文/标签被篡改必须失败
 * - 每次加密产出不同盐与 IV（不可确定性复用）
 * - 密码强度校验
 * - encryptMeta 解析的健壮性（非法 JSON / 缺字段 / 版本不符）
 * - 与客户端对齐的公开参数
 */
import { describe, it, expect } from 'vitest';
import {
  encryptContent,
  decryptContent,
  parseEncryptMeta,
  assertPasswordStrength,
  ArticleCryptoError,
  CRYPTO_PARAMS,
  MIN_PASSWORD_LENGTH,
} from '../src/lib/article-crypto';

describe('文章加密：AES-256-GCM + PBKDF2', () => {
  const PASSWORD = 'my-blog-secret-2026';

  it('加解密往返还原原文', () => {
    const plain = '# 标题\n\n正文内容，包含中文与 emoji 🎉\n\n- 列表项\n';
    const meta = encryptContent(plain, PASSWORD);
    expect(decryptContent(meta, PASSWORD)).toBe(plain);
  });

  it('空正文也能正常往返', () => {
    const meta = encryptContent('', PASSWORD);
    expect(decryptContent(meta, PASSWORD)).toBe('');
  });

  it('长文本（100KB）往返一致', () => {
    const plain = '段落内容'.repeat(20000);
    const meta = encryptContent(plain, PASSWORD);
    expect(decryptContent(meta, PASSWORD)).toBe(plain);
  });

  it('密码错误返回 null（而非抛错或乱码）', () => {
    const meta = encryptContent('机密内容', PASSWORD);
    expect(decryptContent(meta, 'wrong-password-123')).toBeNull();
  });

  it('密文被篡改触发 GCM 认证失败', () => {
    const meta = encryptContent('原始机密内容', PASSWORD);
    const buf = Buffer.from(meta.ct, 'base64');
    // 翻转密文中间一个 bit
    buf[Math.floor(buf.length / 2)]! ^= 0x01;
    const tampered = { ...meta, ct: buf.toString('base64') };
    expect(decryptContent(tampered, PASSWORD)).toBeNull();
  });

  it('认证标签被篡改同样失败', () => {
    const meta = encryptContent('原始机密内容', PASSWORD);
    const buf = Buffer.from(meta.ct, 'base64');
    buf[buf.length - 1]! ^= 0x01; // 末尾属于 GCM tag
    expect(decryptContent({ ...meta, ct: buf.toString('base64') }, PASSWORD)).toBeNull();
  });

  it('每次加密使用不同的盐与 IV（同一明文密文不同）', () => {
    const a = encryptContent('同样的正文', PASSWORD);
    const b = encryptContent('同样的正文', PASSWORD);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    // 但都能解回同一明文
    expect(decryptContent(a, PASSWORD)).toBe('同样的正文');
    expect(decryptContent(b, PASSWORD)).toBe('同样的正文');
  });

  it('元数据携带与客户端一致的算法与参数', () => {
    const meta = encryptContent('内容', PASSWORD);
    expect(meta.v).toBe(1);
    expect(meta.algo).toBe('AES-GCM');
    expect(meta.kdf).toBe('PBKDF2-SHA256');
    expect(meta.iterations).toBe(CRYPTO_PARAMS.iterations);
    // 盐 16 字节、IV 12 字节（base64 解码后长度）
    expect(Buffer.from(meta.salt, 'base64').length).toBe(16);
    expect(Buffer.from(meta.iv, 'base64').length).toBe(12);
  });

  it('密码过短被拒绝', () => {
    expect(() => assertPasswordStrength('123')).toThrow(ArticleCryptoError);
    expect(() => encryptContent('内容', '123')).toThrow(/至少/);
  });

  it('空密码被拒绝', () => {
    expect(() => assertPasswordStrength('')).toThrow(ArticleCryptoError);
    expect(() => encryptContent('内容', '')).toThrow(/请设置/);
  });

  it('超长密码被拒绝', () => {
    expect(() => assertPasswordStrength('a'.repeat(300))).toThrow(/最长/);
  });

  it('恰好最小长度的密码可用', () => {
    const pwd = 'a'.repeat(MIN_PASSWORD_LENGTH);
    const meta = encryptContent('内容', pwd);
    expect(decryptContent(meta, pwd)).toBe('内容');
  });
});

describe('加密元数据解析的健壮性', () => {
  it('空串 → null（视作未加密）', () => {
    expect(parseEncryptMeta('')).toBeNull();
    expect(parseEncryptMeta(null)).toBeNull();
    expect(parseEncryptMeta(undefined)).toBeNull();
  });

  it('非法 JSON → null（不抛错）', () => {
    expect(parseEncryptMeta('{不是合法 JSON')).toBeNull();
  });

  it('缺字段 → null', () => {
    expect(parseEncryptMeta(JSON.stringify({ v: 1, algo: 'AES-GCM' }))).toBeNull();
  });

  it('版本不符 → null（为未来换算法预留）', () => {
    expect(
      parseEncryptMeta(JSON.stringify({ v: 99, algo: 'AES-GCM', salt: 'a', iv: 'b', ct: 'c' })),
    ).toBeNull();
  });

  it('合法元数据可解析并成功解密', () => {
    const meta = encryptContent('往返内容', 'password-1234');
    const parsed = parseEncryptMeta(JSON.stringify(meta));
    expect(parsed).not.toBeNull();
    expect(decryptContent(parsed!, 'password-1234')).toBe('往返内容');
  });

  it('缺失 iterations 时回落到默认值', () => {
    const meta = encryptContent('内容', 'password-1234');
    const raw = JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
    delete raw.iterations;
    const parsed = parseEncryptMeta(JSON.stringify(raw));
    expect(parsed?.iterations).toBe(CRYPTO_PARAMS.iterations);
  });
});

describe('公开加密参数', () => {
  it('不泄露任何密钥材料', () => {
    const keys = Object.keys(CRYPTO_PARAMS);
    expect(keys).not.toContain('key');
    expect(keys).not.toContain('password');
    // 参数集合应稳定（客户端依赖这些值派生密钥）
    expect(CRYPTO_PARAMS).toMatchObject({
      version: 1,
      algo: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      saltLength: 16,
      ivLength: 12,
    });
  });
});
