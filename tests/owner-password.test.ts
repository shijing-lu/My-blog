import { describe, expect, it, vi } from 'vitest';

// 这些用例只覆盖纯函数；mock 掉数据库，避免测试进程去连真实 SQLite。
vi.mock('../db', () => ({ db: {}, dbWrite: async () => {} }));

import {
  MAX_OWNER_PASSWORD_LENGTH,
  hashOwnerPassword,
  validateNewOwnerPassword,
  verifyOwnerPasswordHash,
} from '../src/lib/owner-password';

describe('站主口令摘要', () => {
  it('可以校验回原文，且记录里不含明文', () => {
    const record = hashOwnerPassword('correct horse battery staple');
    expect(record.v).toBe(1);
    expect(record.algo).toBe('scrypt');
    expect(JSON.stringify(record)).not.toContain('correct horse');
    expect(verifyOwnerPasswordHash('correct horse battery staple', record)).toBe(true);
    expect(verifyOwnerPasswordHash('wrong password', record)).toBe(false);
  });

  it('同一口令每次生成不同的盐与摘要', () => {
    const a = hashOwnerPassword('same-password');
    const b = hashOwnerPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifyOwnerPasswordHash('same-password', a)).toBe(true);
    expect(verifyOwnerPasswordHash('same-password', b)).toBe(true);
  });

  it('空口令与损坏记录一律拒绝', () => {
    const record = hashOwnerPassword('something-long');
    expect(verifyOwnerPasswordHash('', record)).toBe(false);
    expect(verifyOwnerPasswordHash('something-long', { ...record, hash: '' })).toBe(false);
    expect(verifyOwnerPasswordHash('something-long', { ...record, salt: 'broken' })).toBe(false);
  });
});

describe('新口令规则', () => {
  it('长度合规时通过', () => {
    expect(validateNewOwnerPassword('a-good-password', 'old-password')).toEqual({ password: 'a-good-password' });
  });

  it('拒绝非字符串、过短、过长与未改动', () => {
    expect(validateNewOwnerPassword(undefined)).toHaveProperty('error');
    expect(validateNewOwnerPassword(42)).toHaveProperty('error');
    expect(validateNewOwnerPassword('short')).toHaveProperty('error');
    expect(validateNewOwnerPassword('x'.repeat(MAX_OWNER_PASSWORD_LENGTH + 1))).toHaveProperty('error');
    expect(validateNewOwnerPassword('same-password', 'same-password')).toHaveProperty('error');
  });

  it('拒绝首尾空白，允许中间空格', () => {
    expect(validateNewOwnerPassword(' padded-password ')).toEqual({ error: '新密码首尾不能有空白字符' });
    expect(validateNewOwnerPassword('has inner space')).toEqual({ password: 'has inner space' });
  });

  it('按字符而不是字节计长度', () => {
    expect(validateNewOwnerPassword('密码密码密码密码')).toEqual({ password: '密码密码密码密码' });
    expect(validateNewOwnerPassword('密码密码密码')).toHaveProperty('error');
  });
});
