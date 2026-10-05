/**
 * 授权管理员权限体系纯函数测试
 * （normalizePermissions / checkTopPassword；不触库）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AstroCookies } from 'astro';
import {
  checkTopPassword, isOwnerSession, normalizePermissions, signTopSession, topAdminPassword, verifyTopSessionToken,
} from '../src/lib/admin-auth';
import { createOAuthState, signPayload, signSession, signUserSession, verifySessionToken } from '../src/lib/auth';

afterEach(() => vi.unstubAllEnvs());

describe('normalizePermissions', () => {
  it('保留白名单权限键', () => {
    expect(normalizePermissions(['articles', 'moments'])).toEqual(['articles', 'moments']);
  });

  it('过滤非白名单键与非字符串', () => {
    expect(normalizePermissions(['articles', 'hacker', 123, null])).toEqual(['articles']);
  });

  it('去重', () => {
    expect(normalizePermissions(['nav', 'nav', 'docs'])).toEqual(['nav', 'docs']);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizePermissions('articles')).toEqual([]);
    expect(normalizePermissions(null)).toEqual([]);
    expect(normalizePermissions(undefined)).toEqual([]);
  });
});

describe('checkTopPassword', () => {
  it('未配置站主密码时禁用该通道，拒绝未配置的非空密码和空密码', () => {
    vi.stubEnv('TOP_ADMIN_PASSWORD', '');
    expect(topAdminPassword()).toBe('');
    expect(checkTopPassword('unconfigured-password')).toBe(false);
    expect(checkTopPassword('')).toBe(false);
  });

  it('仅接受显式配置的密码', () => {
    vi.stubEnv('TOP_ADMIN_PASSWORD', 'test-owner-password');
    expect(topAdminPassword()).toBe('test-owner-password');
    expect(checkTopPassword('test-owner-password')).toBe(true);
    expect(checkTopPassword('wrong-password')).toBe(false);
    expect(checkTopPassword('')).toBe(false);
  });
});

describe('站主会话用途隔离', () => {
  it('仅接受专用顶级管理员凭证', () => {
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest');
    expect(verifyTopSessionToken(signTopSession())).toBe(true);
    for (const token of [signSession(), signUserSession('visitor'), createOAuthState()]) {
      expect(verifyTopSessionToken(token)).toBe(false);
    }
    expect(verifyTopSessionToken(signPayload({ role: 'top', exp: Date.now() + 60_000 }))).toBe(false);
    expect(verifySessionToken(signTopSession())).toBe(false);
  });

  it('把公开 OAuth state 或普通用户令牌改名为 admin_session 不能取得站主权限', () => {
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest');
    for (const token of [createOAuthState(), signUserSession('visitor')]) {
      const cookies = { get: (name: string) => name === 'admin_session' ? { value: token } : undefined } as AstroCookies;
      expect(isOwnerSession(cookies)).toBe(false);
    }
  });
});
